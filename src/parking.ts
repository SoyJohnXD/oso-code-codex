import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { captureCommand } from './command.ts';
import { changedCheckoutFiles, matchesClosedCheckpoint } from './contributions.ts';
import { changedFiles, fileModes, scopeMatches, snapshot } from './project.ts';
import { event, startRun } from './lifecycle.ts';
import { listRuns, readRun, stateDirectory, writeRun } from './store.ts';
import type { CheckoutState, ExternalContribution, ParkedState, Run, RunSpec, Snapshot } from './types.ts';

export function ensureLifecycleVersion(run: Run): void {
  if (run.version >= 2) return;
  run.version = 2;
  run.readerMinimumVersion = 2;
}

export function checkoutState(project: string): CheckoutState {
  const files = snapshot(project);
  const modes = fileModes(project, files);
  const head = captureCommand(['git', 'rev-parse', '--revs-only', 'HEAD'], project).trim() || undefined;
  const branch = captureCommand(['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], project).trim() || undefined;
  return { head, branch, files, modes };
}

export function parkedState(run: Run, reason: string): ParkedState {
  const current = checkoutState(run.project);
  return {
    reason, at: new Date().toISOString(), previousStatus: run.status === 'blocked' ? 'blocked' : 'running', selectedBlock: run.activeBlock,
    globalBaseline: { ...run.baseline }, checkout: current,
    evidence: { checks: run.checks.map(check => check.attempt), reviews: [...run.blocks.flatMap(block => block.reviews), ...run.finalReviews].map(review => review.id), failures: run.blocks.flatMap(block => block.failure ? [`${block.id}:${block.failure.signature}`] : []) },
    recoveryBudgets: Object.fromEntries(run.blocks.map(block => [block.id, { rounds: block.rounds.length, blocked: block.status === 'blocked', permissionEpisodes: Object.values(block.permissionEpisodes ?? {}).map(episode => episode.id) }])),
    handles: { checks: run.checks.filter(check => check.status === 'running').map(check => check.attempt), agents: run.agents.filter(agent => agent.status !== 'finished').map(agent => agent.id) },
  };
}

export function parkRun(run: Run, reason: string): void {
  if (!reason.trim()) throw new Error('Parking requires the actual reason for the separate approved work');
  if (!run.approval || !['running', 'blocked'].includes(run.status)) throw new Error('Only an authorized running or blocked run can be parked');
  const runningChecks = run.checks.filter(check => check.status === 'running');
  const unresolvedAgents = run.agents.filter(agent => agent.status !== 'finished');
  if (runningChecks.length || unresolvedAgents.length) throw new Error(`Cannot park while native handles remain unresolved: ${[...runningChecks.map(check => check.attempt), ...unresolvedAgents.map(agent => agent.id)].join(', ')}`);
  ensureLifecycleVersion(run);
  run.parked = parkedState(run, reason);
  run.status = 'parked';
  run.next = 'Parked. Start an approved successor from this run only with a clean unchanged checkout, or resume this selected evidence.';
  event(run, 'park', reason);
}

export function transitionStatus(project: string, selected?: string): object {
  const directory = path.join(stateDirectory(project), 'runs');
  const ids = existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort() : [];
  const active = selected ?? (existsSync(path.join(stateDirectory(project), 'active')) ? readFileSync(path.join(stateDirectory(project), 'active'), 'utf8').trim() : undefined);
  const runs = ids.map(id => readRun(project, id));
  return {
    selected: active,
    transitions: runs.map(run => ({ id: run.spec.id, status: run.status, selected: run.spec.id === active, park: parkEligibility(run), resume: resumeEligibility(run), amendUntouched: amendEligibility(run) })),
  };
}

function parkEligibility(run: Run): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!['running', 'blocked'].includes(run.status)) reasons.push('run is not active');
  if (!run.approval) reasons.push('run lacks approval');
  if (run.checks.some(check => check.status === 'running')) reasons.push('a check is still running');
  if (run.agents.some(agent => agent.status !== 'finished')) reasons.push('a native agent is unresolved');
  return { eligible: reasons.length === 0, reasons };
}

function resumeEligibility(run: Run): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (run.status !== 'parked') reasons.push('run is not parked');
  if (!run.parked) reasons.push('park record is missing');
  if (run.parked && unresolvedSuccessors(run).length) reasons.push(`successor remains incomplete: ${unresolvedSuccessors(run).map(entry => entry.spec.id).join(', ')}`);
  return { eligible: reasons.length === 0, reasons };
}

function amendEligibility(run: Run): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (run.status !== 'parked') reasons.push('run is not parked');
  if (!run.parked?.selectedBlock) reasons.push('no selected block was retained');
  const block = run.blocks.find(entry => entry.id === run.parked?.selectedBlock);
  if (!block || !untouched(run, block.id)) reasons.push('selected block has material execution evidence');
  return { eligible: reasons.length === 0, reasons };
}

export function startFromParkedRun(project: string, parked: Run, spec: RunSpec): Run {
  if (parked.status !== 'parked' || !parked.parked) throw new Error(`Run ${parked.spec.id} is not parked`);
  const selected = readFileSync(path.join(stateDirectory(project), 'active'), 'utf8').trim();
  if (selected !== parked.spec.id) throw new Error(`Parked run ${parked.spec.id} is not selected for this checkout`);
  if (parked.spec.id === spec.id) throw new Error('A parked run must resume its own identity; use a new run id for a successor');
  if (sameObjective(spec.objective, parked.spec.objective) && parked.blocks.some(block => block.failure)) throw new Error('A successor cannot disguise repair of the parked run’s failed objective; preserve its recovery budget');
  assertSameCheckout(parked.parked.checkout, checkoutState(project), 'Start a successor only from the clean checkout preserved at parking');
  if (captureCommand(['git', 'status', '--porcelain=v1'], project).trim()) throw new Error('Start a successor only from a clean Git checkout; slice 3 does not move dirty parked work');
  const run = startRun(project, spec, { parkedPredecessor: parked.spec.id });
  event(run, 'parked-successor', parked.spec.id);
  writeRun(run);
  return run;
}

export function resumeParkedRun(run: Run): void {
  if (run.status !== 'parked' || !run.parked) throw new Error('Resume selects an existing parked run');
  const successors = successorsOf(run);
  const pending = successors.filter(successor => successor.status !== 'closed');
  if (pending.length) throw new Error(`Cannot resume ${run.spec.id}; successor ${pending.map(entry => entry.spec.id).join(', ')} is pending, so its external delta is not reviewed and committed`);
  for (const successor of successors) recordReviewedContribution(run, successor);
  run.status = run.parked.previousStatus === 'blocked' ? 'blocked' : 'running';
  if (run.selectionAmendment?.pending || run.parked.untouchedSelectionPending) run.next = 'Activate the newly approved prerequisite block before returning to the retained selection.';
  else run.next = run.activeBlock ? `Resume ${run.activeBlock} with its retained evidence and recovery budget.` : 'Activate the next approved block.';
  event(run, 'resume-parked', run.parked.reason);
}

export function effectiveSnapshot(run: Run, baseline: Snapshot, dimension: 'files' | 'modes' = 'files'): Snapshot {
  const effective = { ...baseline };
  for (const contribution of run.externalContributions ?? []) {
    for (const filename of changedCheckoutFiles(contribution.before, contribution.after)) {
      if (contribution.after[dimension][filename] === undefined) delete effective[filename];
      else effective[filename] = contribution.after[dimension][filename]!;
    }
  }
  return effective;
}

export function ownershipChanges(run: Run, baseline: Snapshot, modes: Snapshot | undefined, reference: string | undefined): string[] {
  const current = snapshot(run.project);
  const knownModes = modes ?? run.parked?.checkout.modes ?? Object.fromEntries((reference ? captureCommand(['git', 'ls-tree', '-r', '-z', reference], run.project) : '').split('\0').filter(Boolean).map(entry => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0]!]));
  return [...new Set([...changedFiles(effectiveSnapshot(run, baseline), current), ...changedFiles(effectiveSnapshot(run, knownModes, 'modes'), fileModes(run.project, current))])];
}

export function amendUntouchedSelection(run: Run, specification: RunSpec): boolean {
  const selected = run.status === 'parked' ? run.parked?.selectedBlock : run.activeBlock;
  if (!selected) return false;
  const prior = run.spec.blocks.findIndex(block => block.id === selected);
  const next = specification.blocks.findIndex(block => block.id === selected);
  if (prior < 0 || next < 1 || specification.blocks.length <= run.spec.blocks.length || !untouched(run, selected)) return false;
  const inserted = specification.blocks.slice(0, next).filter(block => !run.blocks.some(existing => existing.id === block.id));
  if (!inserted.length || inserted.some(block => (block.dependsOn ?? []).includes(selected))) throw new Error('An untouched amendment may insert only a prerequisite before the retained selected block');
  if (run.parked) run.parked.untouchedSelectionPending = true;
  run.selectionAmendment = { retainedBlock: selected, pending: true };
  run.blocks.find(block => block.id === selected)!.status = 'pending';
  ensureLifecycleVersion(run);
  delete run.activeBlock;
  event(run, 'untouched-selection-pending', inserted.map(block => block.id).join(','));
  return true;
}

export function recordReviewedContribution(run: Run, successor: Run): void {
  const existing = run.externalContributions?.find(entry => entry.sourceRun === successor.spec.id);
  if (existing) return;
  const closed = successor.blocks.filter(block => block.status === 'closed');
  if (successor.status !== 'closed' || !closed.length || successor.activeBlock || successor.blocks.some(block => block.status !== 'closed')) throw new Error(`Successor ${successor.spec.id} lacks reviewed closed checkpoints`);
  const before = run.parked!.checkout;
  const after = checkoutState(run.project);
  if (before.branch !== after.branch) throw new Error(`Successor ${successor.spec.id} was not committed on the parked run's branch`);
  if (captureCommand(['git', 'status', '--porcelain=v1'], run.project).trim()) throw new Error(`Successor ${successor.spec.id} must be committed cleanly before its external contribution can be recorded`);
  const commits = commitsSince(run.project, before.head, after.head);
  if (!commits.length) throw new Error(`Successor ${successor.spec.id} is closed but has no committed external contribution`);
  const sourceDelta = changedCheckoutFiles(before, after);
  const nested = nestedContributions(run.project, successor, new Set([successor.spec.id]));
  const unreviewed = sourceDelta.filter(filename => !successor.blocks.some(block => block.status === 'closed' && matchesClosedCheckpoint(block, filename, after)) && !nested.some(entry => matchesContribution(entry, filename, after)));
  if (unreviewed.length) throw new Error(`Successor ${successor.spec.id} has unknown or unreviewed committed delta: ${unreviewed.join(', ')}`);
  const committedFiles = commits.flatMap(commit => commitFiles(run.project, commit));
  const reviewedScopes = [...closed.map(block => scopeOf(successor, block.id)), ...nested.flatMap(entry => entry.source.blocks.filter(block => block.status === 'closed').map(block => scopeOf(entry.source, block.id)))];
  const unknownCommitted = [...new Set(committedFiles.filter(filename => !reviewedScopes.some(scope => scopeMatches(filename, scope))))];
  if (unknownCommitted.length) throw new Error(`Successor ${successor.spec.id} has unknown committed delta: ${unknownCommitted.join(', ')}`);
  const contribution: ExternalContribution = { sourceRun: successor.spec.id, sourceSpecDigest: successor.specDigest, reviewedCheckpoints: closed.map(block => block.id), commits, before, after, recordedAt: new Date().toISOString() };
  (run.externalContributions ??= []).push(contribution);
  event(run, 'external-contribution', `${successor.spec.id}: ${commits.join(',')}`);
}

function nestedContributions(project: string, successor: Run, seen: Set<string>): { source: Run; contribution: ExternalContribution }[] {
  const nested: { source: Run; contribution: ExternalContribution }[] = [];
  for (const contribution of successor.externalContributions ?? []) {
    if (seen.has(contribution.sourceRun)) throw new Error(`Successor ${successor.spec.id} has cyclic external contribution provenance`);
    const source = readRun(project, contribution.sourceRun);
    if (source.status !== 'closed' || source.specDigest !== contribution.sourceSpecDigest || !sameSequence(commitsSince(project, contribution.before.head, contribution.after.head), contribution.commits)) throw new Error(`Successor ${successor.spec.id} has unverifiable nested contribution ${contribution.sourceRun}`);
    const changed = changedCheckoutFiles(contribution.before, contribution.after);
    const checkpoints = new Set(contribution.reviewedCheckpoints);
    const descendants = nestedContributions(project, source, new Set([...seen, contribution.sourceRun]));
    if (!changed.length || !checkpoints.size || changed.some(filename => !source.blocks.some(block => block.status === 'closed' && checkpoints.has(block.id) && matchesClosedCheckpoint(block, filename, contribution.after)) && !descendants.some(entry => matchesContribution(entry, filename, contribution.after)))) throw new Error(`Successor ${successor.spec.id} has unknown nested contribution ${contribution.sourceRun}`);
    nested.push({ source, contribution });
    nested.push(...descendants);
  }
  return nested;
}

function matchesContribution(entry: { source: Run; contribution: ExternalContribution }, filename: string, after: CheckoutState): boolean {
  const changed = changedCheckoutFiles(entry.contribution.before, entry.contribution.after);
  return changed.includes(filename) && entry.contribution.after.files[filename] === after.files[filename] && entry.contribution.after.modes[filename] === after.modes[filename] && entry.source.blocks.some(block => block.status === 'closed' && entry.contribution.reviewedCheckpoints.includes(block.id) && matchesClosedCheckpoint(block, filename, entry.contribution.after));
}

function sameSequence(left: string[], right: string[]): boolean { return left.length === right.length && left.every((entry, index) => entry === right[index]); }

function successorsOf(run: Run): Run[] {
  return listRuns(run.project).filter(candidate => candidate.spec.id !== run.spec.id && candidate.link?.parkedRun === run.spec.id);
}

function unresolvedSuccessors(run: Run): Run[] { return successorsOf(run).filter(successor => successor.status !== 'closed'); }

function untouched(run: Run, id: string): boolean {
  const block = run.blocks.find(entry => entry.id === id);
  const specification = run.spec.blocks.find(entry => entry.id === id);
  if (!block || !specification || block.reviews.length || block.findings.length || block.rounds.length || block.failure || block.writers.length !== 1 || run.agents.some(agent => agent.block === id) || run.checks.some(check => check.block === id)) return false;
  if (!block.baselineModes) return false;
  const before = selectScope(block.baseline ?? run.baseline, specification.scope);
  const now = snapshot(run.project, specification.scope);
  if (changedFiles(before, now).length) return false;
  const beforeModes = selectScope(block.baselineModes, specification.scope);
  const currentModes = fileModes(run.project, now);
  return changedFiles(beforeModes, currentModes).length === 0;
}

function selectScope(files: Snapshot, scope: string[]): Snapshot { return Object.fromEntries(Object.entries(files).filter(([filename]) => scopeMatches(filename, scope))); }

function assertSameCheckout(expected: CheckoutState, actual: CheckoutState, message: string): void {
  if (expected.head !== actual.head || expected.branch !== actual.branch || changedCheckoutFiles(expected, actual).length) throw new Error(message);
}

function commitsSince(project: string, before?: string, after?: string): string[] {
  if (!before || !after) return [];
  return captureCommand(['git', 'rev-list', '--reverse', `${before}..${after}`], project).trim().split(/\s+/).filter(Boolean);
}

function commitFiles(project: string, commit: string): string[] {
  return captureCommand(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], project).split(/\r?\n/).filter(Boolean);
}

function scopeOf(run: Run, id: string): string[] { return run.spec.blocks.find(block => block.id === id)?.scope ?? []; }

function sameObjective(left: string, right: string): boolean { return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase(); }
