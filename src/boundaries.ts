import { captureCommand, captureCommandBytes } from './command.ts';
import { changedCheckoutFiles } from './contributions.ts';
import { event, requireAuthorization } from './lifecycle.ts';
import { digest } from './project.ts';
import { listRuns, writeRun } from './store.ts';
import { crossProjectPeers } from './isolated.ts';
import type { Boundary, BoundaryAction, CheckoutState, ExternalContribution, IntegrationIntent, Run } from './types.ts';

export function blockBoundary(run: Run, action: BoundaryAction, cause: string): void {
  requireAuthorization(run, 'metadata');
  if (!cause.trim()) throw new Error('Record the actual required delivery action and its observed failure');
  const previous = familyBoundary(run, action);
  const boundaries = run.boundaries ??= {};
  boundaries[action] = { status: 'open', cause, rounds: previous?.rounds ?? [] };
  syncFamilyBoundary(run, action, boundaries[action]!);
  run.next = `${action} remains blocked: ${cause}. Preserve this boundary across slices; do not retry the unchanged environment.`;
  event(run, 'boundary-blocked', `${action}: ${cause}`);
}

/** Records the durable operation identity for a failed native integration. */
export function blockIntegrationBoundary(run: Run, intent: IntegrationIntent, cause: string): void {
  blockBoundary(run, 'commit', cause);
  const boundary = run.boundaries!.commit!;
  boundary.integration = {
    sourceRun: intent.sourceRun, sourceSpecDigest: intent.sourceSpecDigest, commits: [...intent.commits],
    beforeHead: requiredHead(intent.before.head), afterHead: requiredHead(intent.after.head),
  };
  syncFamilyBoundary(run, 'commit', boundary);
}

export function resolveBoundary(run: Run, action: BoundaryAction, evidence: string, escalated: boolean): void {
  requireAuthorization(run, 'metadata');
  const boundary = familyBoundary(run, action);
  if (!boundary || boundary.status !== 'open') throw new Error('There is no unresolved delivery boundary for that action');
  if (!evidence.trim() || evidence === boundary.cause || boundary.rounds.some(round => round.evidence === evidence)) throw new Error('Provide new actual permission, completed-action or authorized scope-change evidence');
  const ordinary = boundary.rounds.filter(round => !round.escalated).length;
  if ((!escalated && ordinary >= 2) || (escalated && (ordinary < 2 || boundary.rounds.some(round => round.escalated)))) throw new Error('Delivery recovery budget exhausted or escalation out of order; preserve the concrete blocker');
  boundary.rounds.push({ evidence, escalated, at: new Date().toISOString() });
  boundary.status = 'resolved';
  syncFamilyBoundary(run, action, boundary);
  event(run, 'boundary-resolved', `${action}: ${evidence}`);
  run.next = 'Continue from the existing reviewed checkpoint using current evidence';
}

/**
 * Reconciles an integration which Git has already completed. This is not a
 * delivery retry: it accepts only durable integration provenance tied to the
 * open failure, and never consumes or resets the boundary retry budget.
 */
export function resolveCompletedIntegrationBoundary(run: Run, sourceRun: string, evidence: string): void {
  requireAuthorization(run, 'metadata');
  if (!sourceRun.trim() || !evidence.trim()) throw new Error('Completed integration reconciliation requires its recorded source run and actual evidence');
  const boundary = familyBoundary(run, 'commit');
  if (!boundary) throw new Error('There is no recorded commit delivery boundary to reconcile');
  const contribution = matchingCompletedIntegration(run, boundary, sourceRun);
  const verifiedHead = verifyCompletedIntegration(run.project, contribution);
  const existing = boundary.completion;
  if (boundary.status === 'resolved') {
    if (existing?.kind === 'completed-integration' && existing.sourceRun === sourceRun && existing.evidence === evidence && existing.afterHead === contribution.after.head) return;
    throw new Error('There is no unresolved delivery boundary for that action');
  }
  boundary.status = 'resolved';
  boundary.completion = {
    kind: 'completed-integration', sourceRun, sourceSpecDigest: contribution.sourceSpecDigest,
    commits: [...contribution.commits], beforeHead: contribution.before.head!, afterHead: contribution.after.head!, verifiedHead,
    evidence, at: new Date().toISOString(),
  };
  syncFamilyBoundary(run, 'commit', boundary);
  event(run, 'boundary-completed-integration', `${sourceRun}: ${contribution.commits.join(',')} (${evidence})`);
  run.next = 'Continue from the existing reviewed checkpoint; the completed Git integration was verified without another delivery attempt.';
}

export function familyBoundary(run: Run, action: BoundaryAction): Boundary | undefined {
  return linkedFamily(run).flatMap(candidate => candidate.boundaries?.[action] ? [candidate.boundaries[action]!] : [])
    .sort((left, right) => right.rounds.length - left.rounds.length || Number(right.status === 'open') - Number(left.status === 'open'))[0];
}

function syncFamilyBoundary(run: Run, action: BoundaryAction, boundary: Boundary): void {
  for (const member of linkedFamily(run)) {
    (member.boundaries ??= {})[action] = structuredClone(boundary);
    if (member.spec.id !== run.spec.id) writeRun(member);
  }
}

function linkedFamily(run: Run): Run[] {
  const runs = [...listRuns(run.project).map(candidate => candidate.spec.id === run.spec.id ? run : candidate), ...crossProjectPeers(run)];
  if (!runs.some(candidate => candidate.spec.id === run.spec.id)) runs.push(run);
  const linked = new Set([run.spec.id]);
  let previous = 0;
  while (previous !== linked.size) {
    previous = linked.size;
    for (const candidate of runs) {
      const parent = candidate.link?.parkedRun;
      if (parent && (linked.has(parent) || linked.has(candidate.spec.id))) { linked.add(parent); linked.add(candidate.spec.id); }
    }
  }
  return runs.filter(candidate => linked.has(candidate.spec.id));
}

function matchingCompletedIntegration(run: Run, boundary: Boundary, sourceRun: string): ExternalContribution {
  const matches = (run.externalContributions ?? []).filter(candidate => candidate.sourceRun === sourceRun);
  if (matches.length !== 1) throw new Error(matches.length ? `Completed integration source ${sourceRun} is ambiguous` : `No registered completed integration exists for ${sourceRun}`);
  const contribution = matches[0]!;
  if (boundary.integration) {
    const operation = boundary.integration;
    if (operation.sourceRun !== contribution.sourceRun || operation.sourceSpecDigest !== contribution.sourceSpecDigest || operation.afterHead !== contribution.after.head || !sameSequence(operation.commits, contribution.commits) || !isAncestor(run.project, contribution.before.head!, operation.beforeHead) || !isAncestor(run.project, operation.beforeHead, contribution.after.head!) || operation.beforeHead === contribution.after.head) throw new Error(`Registered source ${sourceRun} does not complete the open failed integration`);
    return contribution;
  }
  return matchingLegacyCompletedIntegration(run, boundary, sourceRun, contribution);
}

function matchingLegacyCompletedIntegration(run: Run, boundary: Boundary, sourceRun: string, contribution: ExternalContribution): ExternalContribution {
  const blocked = run.events.findLastIndex(entry => entry.action === 'boundary-blocked' && entry.detail === `commit: ${boundary.cause}`);
  if (blocked < 0) throw new Error('The open integration boundary has no durable blocked-delivery event');
  const failed = run.events.findIndex((entry, index) => index > blocked && entry.action === 'integration-failed');
  const intent = run.events.findLastIndex((entry, index) => index < blocked && entry.action === 'integration-intent');
  const finalized = run.events.findIndex((entry, index) => index > failed && entry.action === 'integration-finalized' && entry.detail === sourceRun);
  if (intent < 0 || integrationSource(run.events[intent]!.detail) !== sourceRun || failed !== blocked + 1 || finalized < 0 || run.events.slice(intent + 1, finalized).some(entry => entry.action === 'integration-finalized')) throw new Error(`Registered source ${sourceRun} does not complete the open failed integration`);
  return contribution;
}

function verifyCompletedIntegration(project: string, contribution: ExternalContribution): string {
  validateContribution(contribution);
  const before = contribution.before.head!;
  const after = contribution.after.head!;
  const current = head(project);
  if (!isAncestor(project, before, after) || !isAncestor(project, after, current)) throw new Error('Completed integration Git ancestry no longer proves the recorded after state is retained');
  const commits = captureCommand(['git', 'rev-list', '--reverse', `${before}..${after}`], project).trim().split(/\s+/).filter(Boolean);
  if (!sameSequence(commits, contribution.commits)) throw new Error('Completed integration commit interval does not match its registered provenance');
  const changed = changedCheckoutFiles(contribution.before, contribution.after);
  const actualChanged = captureCommand(['git', 'diff', '--no-renames', '--name-only', '-z', before, after], project).split('\0').filter(Boolean).sort();
  if (!sameSequence(changed, actualChanged)) throw new Error('Completed integration recorded snapshot delta does not exactly match the immutable Git diff');
  if (!changed.length && tree(project, before) !== tree(project, after)) throw new Error('Completed integration records an empty delta but its Git trees differ');
  for (const filename of changed) {
    verifyTreeEntry(project, before, filename, contribution.before);
    verifyTreeEntry(project, after, filename, contribution.after);
  }
  return current;
}

function validateContribution(contribution: ExternalContribution): void {
  if (!identifier(contribution.sourceRun) || !hash(contribution.sourceSpecDigest) || !Array.isArray(contribution.reviewedCheckpoints) || !contribution.reviewedCheckpoints.length || contribution.reviewedCheckpoints.some(checkpoint => !identifier(checkpoint)) || !Array.isArray(contribution.commits) || !contribution.commits.length || contribution.commits.some(commit => !gitHash(commit)) || new Set(contribution.commits).size !== contribution.commits.length || !timestamp(contribution.recordedAt) || !checkout(contribution.before) || !checkout(contribution.after)) throw new Error('Registered completed integration provenance is malformed');
}

function checkout(state: CheckoutState): boolean {
  return gitHash(state.head) && snapshot(state.files) && modes(state.modes) && sameKeys(state.files, state.modes);
}

function snapshot(value: Record<string, string>): boolean { return Object.entries(value).every(([filename, value]) => Boolean(filename) && hash(value)); }
function modes(value: Record<string, string>): boolean { return Object.entries(value).every(([filename, mode]) => Boolean(filename) && ['100644', '100755', '120000'].includes(mode)); }
function sameKeys(left: Record<string, string>, right: Record<string, string>): boolean { const leftKeys = Object.keys(left).sort(); const rightKeys = Object.keys(right).sort(); return sameSequence(leftKeys, rightKeys); }
function identifier(value: string): boolean { return Boolean(value.trim()) && !/[\r\n\0]/.test(value); }
function hash(value: string | undefined): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function gitHash(value: string | undefined): boolean { return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value); }
function timestamp(value: string): boolean { return !Number.isNaN(Date.parse(value)); }

function verifyTreeEntry(project: string, reference: string, filename: string, state: CheckoutState): void {
  const expectedHash = state.files[filename];
  const expectedMode = state.modes[filename];
  const entry = treeEntry(project, reference, filename);
  if (expectedHash === undefined || expectedMode === undefined) {
    if (expectedHash !== undefined || expectedMode !== undefined || entry) throw new Error(`Completed integration tree does not match the recorded deletion of ${filename}`);
    return;
  }
  if (!entry || entry.mode !== expectedMode) throw new Error(`Completed integration tree mode does not match recorded provenance for ${filename}`);
  const bytes = captureCommandBytes(['git', 'cat-file', 'blob', entry.object], project);
  const actualHash = entry.mode === '120000' ? digest(`link:${bytes.toString('utf8')}:`) : digest(bytes);
  if (actualHash !== expectedHash) throw new Error(`Completed integration tree hash does not match recorded provenance for ${filename}`);
}

function treeEntry(project: string, reference: string, filename: string): { mode: string; object: string } | undefined {
  const output = captureCommand(['git', 'ls-tree', '-z', reference, '--', filename], project);
  if (!output) return undefined;
  const entry = output.slice(0, -1);
  const separator = entry.indexOf('\t');
  const [mode, type, object] = entry.slice(0, separator).split(' ');
  if (separator < 0 || entry.slice(separator + 1) !== filename || type !== 'blob' || !['100644', '100755', '120000'].includes(mode ?? '') || !gitHash(object)) throw new Error(`Completed integration has an invalid Git tree entry for ${filename}`);
  return { mode: mode!, object: object! };
}

function head(project: string): string {
  const value = captureCommand(['git', 'rev-parse', '--revs-only', 'HEAD'], project).trim();
  if (!gitHash(value)) throw new Error('Completed integration checkout has no valid Git HEAD');
  return value;
}

function requiredHead(value: string | undefined): string {
  if (!gitHash(value)) throw new Error('Native integration intent lacks a valid Git head');
  return value!;
}

function tree(project: string, reference: string): string { return captureCommand(['git', 'rev-parse', `${reference}^{tree}`], project).trim(); }
function isAncestor(project: string, ancestor: string, descendant: string): boolean { return captureCommand(['git', 'merge-base', ancestor, descendant], project).trim() === ancestor; }
function sameSequence(left: string[], right: string[]): boolean { return left.length === right.length && left.every((entry, index) => entry === right[index]); }
function integrationSource(detail: string): string { const separator = detail.indexOf('@'); return separator > 0 ? detail.slice(0, separator) : ''; }
