import { digest } from './project.ts';
import { readRun, transaction, writeRun } from './store.ts';
import type { Approval, RoadmapAuthority, RoadmapBaseline, RoadmapLineage, Run, RunSpec } from './types.ts';

export function roadmapBaseline(parent: Run, child: RunSpec): RoadmapBaseline {
  return { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.id, originalSpecDigest: digest(JSON.stringify(child)) };
}

function promoteRoadmapLineageRecord(run: Run): void {
  run.version = 5;
  run.readerMinimumVersion = 5;
}

export function retainLegacyWriterAttribution(run: Run): void {
  for (const block of run.blocks) {
    if (block.contributions !== undefined) continue;
    block.contributions = [];
    if (block.unattributedWriters === undefined && block.writers.length) block.unattributedWriters = [...block.writers];
  }
}

export function roadmapParentId(run: Run): string | undefined {
  return run.roadmapLineage?.baseline.parentRun ?? run.roadmapOrigin?.parentRun;
}

export function hasValidRoadmapLineage(run: Run): boolean {
  const lineage = run.roadmapLineage;
  if (!lineage || run.version !== 5 || run.readerMinimumVersion !== 5) return false;
  if (!matchesAuthority(run.roadmapOrigin, lineage.baseline) || !digestValue(lineage.baseline.originalSpecDigest)) return false;
  let expected = lineage.baseline.originalSpecDigest;
  const seen = new Set([expected]);
  for (const amendment of lineage.amendments) {
    if (amendment.fromDigest !== expected || seen.has(amendment.toDigest) || !isUserApproval(amendment.authorization) || amendment.authorization.specDigest !== amendment.toDigest || !['additive', 'replacement'].includes(amendment.compatibility) || !['amend', 'legacy-reconcile'].includes(amendment.provenance) || !timestamp(amendment.at) || !digestValue(amendment.toDigest)) return false;
    expected = amendment.toDigest;
    seen.add(expected);
  }
  return expected === run.specDigest;
}

export function childSatisfiesRoadmap(parent: Run, specification: RunSpec, child: Run): boolean {
  const originalDigest = digest(JSON.stringify(specification));
  const authority = { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id };
  const lineage = child.roadmapLineage;
  if (lineage) return hasValidRoadmapLineage(child) && matchesAuthority(lineage.baseline, authority) && lineage.baseline.originalSpecDigest === originalDigest && lineage.amendments.every(amendment => amendment.compatibility === 'additive') && lineageApprovalMatches(child, authority, lineage);
  if (child.specDigest !== originalDigest) return false;
  return (!child.roadmapOrigin || matchesAuthority(child.roadmapOrigin, authority)) && roadmapApprovalMatches(child, authority);
}

export function applyRoadmapAmendment(run: Run, parent: Run, specification: RunSpec, approval: Extract<Approval, { kind: 'user' }>): void {
  const original = originalChild(parent, run);
  const lineage = existingOrNewLineage(run, parent, original);
  const previous = run.spec;
  const compatibility = isAdditive(previous, specification) && isAdditive(original, specification) ? 'additive' : 'replacement';
  reopenAffectedClosedBlocks(run, previous, specification);
  for (const block of specification.blocks) if (!run.blocks.some(entry => entry.id === block.id)) run.blocks.push(specification.coordination || specification.reviewFallback
    ? { id: block.id, status: 'pending', writers: [], contributions: [], reviews: [], findings: [], rounds: [] }
    : { id: block.id, status: 'pending', writers: [specification.principal], implementationTier: 'luna', reviews: [], findings: [], rounds: [] });
  const now = new Date().toISOString();
  run.roadmapLineage = { ...lineage, amendments: [...lineage.amendments, { fromDigest: run.specDigest, toDigest: approval.specDigest, authorization: approval, compatibility, at: now, provenance: 'amend' }] };
  run.spec = specification;
  run.specDigest = approval.specDigest;
  run.approval = approval;
  if (specification.coordination || specification.reviewFallback) retainLegacyWriterAttribution(run);
  promoteRoadmapLineageRecord(run);
  run.events.push({ at: now, action: 'amend-from', detail: JSON.stringify(previous) });
}

export function reconcileRoadmapChild(project: string, parentId: string, childId: string): Run {
  return transaction(project, () => {
    const parent = readRun(project, parentId);
    const child = readRun(project, childId);
    const original = originalChild(parent, child);
    requireApprovedParent(parent);
    if (!matchesAuthority(child.roadmapOrigin, roadmapBaseline(parent, original))) throw new Error('Legacy roadmap reconciliation requires the exact durable original parent binding');
    if (child.roadmapLineage) {
      if (!childSatisfiesRoadmap(parent, original, child)) throw new Error('Existing roadmap lineage is structurally inconsistent; no reconciliation was applied');
      return child;
    }
    if (child.specDigest === digest(JSON.stringify(original))) throw new Error('Exact legacy child already satisfies the approved roadmap');
    const authorization = currentUserApproval(child);
    const sequence = legacySequence(child, original);
    if (!sequence.slice(1).every((specification, index) => isAdditive(sequence[index]!, specification))) throw new Error('Legacy roadmap history changes original obligations; reconciliation requires an additive chain');
    const baseline = roadmapBaseline(parent, original);
    const now = new Date().toISOString();
    child.roadmapLineage = { baseline, amendments: [{ fromDigest: baseline.originalSpecDigest, toDigest: child.specDigest, authorization, compatibility: 'additive', at: now, provenance: 'legacy-reconcile' }] };
    promoteRoadmapLineageRecord(child);
    child.events.push({ at: now, action: 'roadmap-reconcile', detail: authorization.reference });
    writeRun(child);
    return child;
  });
}

function isAdditive(previous: RunSpec, next: RunSpec): boolean {
  return previous.id === next.id && previous.mode === next.mode && previous.objective === next.objective && previous.principal === next.principal && equal(previous.recovery, next.recovery) && policyAdditive(previous, next) && previous.publication === next.publication && prefix(previous.decisions, next.decisions) && prefix(previous.checks, next.checks) && prefix(previous.dependsOn ?? [], next.dependsOn ?? []) && prefixBlocks(previous.blocks, next.blocks) && equal(previous.children, next.children);
}

function policyAdditive(previous: RunSpec, next: RunSpec): boolean {
  return (previous.coordination === undefined || equal(previous.coordination, next.coordination)) && (previous.reviewFallback === undefined || equal(previous.reviewFallback, next.reviewFallback));
}


function originalChild(parent: Run, child: Run): RunSpec {
  requireApprovedParent(parent);
  const specification = parent.spec.children?.find(entry => entry.id === child.spec.id);
  if (!specification) throw new Error('Roadmap child is not embedded in the approved parent');
  return specification;
}

function existingOrNewLineage(run: Run, parent: Run, original: RunSpec): RoadmapLineage {
  if (!run.roadmapLineage) {
    if (run.specDigest !== digest(JSON.stringify(original))) throw new Error('Legacy amended roadmap child requires roadmap reconcile before another amendment');
    return { baseline: roadmapBaseline(parent, original), amendments: [] };
  }
  const baseline = roadmapBaseline(parent, original);
  if (!hasValidRoadmapLineage(run) || !equal(run.roadmapLineage.baseline, baseline)) throw new Error('Roadmap lineage no longer matches its approved original child');
  return run.roadmapLineage;
}

function reopenAffectedClosedBlocks(run: Run, previous: RunSpec, next: RunSpec): void {
  const changedChecks = new Set(next.checks.filter(check => !equal(check, previous.checks.find(entry => entry.id === check.id))).map(check => check.id));
  for (const state of run.blocks.filter(block => block.status === 'closed')) {
    const prior = previous.blocks.find(block => block.id === state.id);
    const amended = next.blocks.find(block => block.id === state.id);
    if (!prior || !amended || equal(prior, amended) && !amended.checks.some(check => changedChecks.has(check))) continue;
    state.status = 'pending';
    delete state.closedSnapshot;
    delete state.closedModes;
    delete state.closedDeletions;
    delete state.externalFulfillment;
  }
}

function legacySequence(child: Run, original: RunSpec): RunSpec[] {
  const prior = child.events.filter(event => event.action === 'amend-from').map(event => parseLegacySpec(event.detail));
  const sequence = [...prior, child.spec];
  if (!sequence.length || digest(JSON.stringify(sequence[0])) !== digest(JSON.stringify(original))) throw new Error('Legacy roadmap amendment history does not begin at the approved child');
  const digests = sequence.map(specification => digest(JSON.stringify(specification)));
  if (new Set(digests).size !== digests.length) throw new Error('Legacy roadmap amendment history is cyclic or ambiguous');
  if (sequence.some(specification => specification.id !== child.spec.id)) throw new Error('Legacy roadmap amendment history has a conflicting child identity');
  return sequence;
}

function parseLegacySpec(detail: string): RunSpec {
  try {
    const value = JSON.parse(detail) as RunSpec;
    if (!value || typeof value !== 'object' || !Array.isArray(value.blocks) || !Array.isArray(value.checks)) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Legacy roadmap amendment history is partial or unparsable');
  }
}

function currentUserApproval(run: Run): Extract<Approval, { kind: 'user' }> {
  if (!isUserApproval(run.approval) || run.approval.specDigest !== run.specDigest) throw new Error('Legacy roadmap reconciliation needs actual current user authorization for this child digest');
  return run.approval;
}

function requireApprovedParent(parent: Run): void {
  if (parent.spec.mode !== 'roadmap' || !parent.approval || parent.status === 'closed' || parent.specDigest !== digest(JSON.stringify(parent.spec))) throw new Error('Reconciliation requires an approved unchanged unfinished roadmap parent');
}

function matchesAuthority(actual: RoadmapAuthority | undefined, expected: RoadmapAuthority): boolean {
  return actual?.parentRun === expected.parentRun && actual.parentDigest === expected.parentDigest && actual.child === expected.child;
}

function isUserApproval(approval: Approval | undefined): approval is Extract<Approval, { kind: 'user' }> {
  return approval?.kind === 'user' && Boolean(approval.reference?.trim()) && Boolean(approval.message?.trim()) && digestValue(approval.specDigest);
}

function lineageApprovalMatches(child: Run, authority: RoadmapAuthority, lineage: RoadmapLineage): boolean {
  const amendment = lineage.amendments.at(-1);
  if (!amendment) return roadmapApprovalMatches(child, authority);
  return child.approval?.kind === 'user' && equal(child.approval, amendment.authorization) && child.approval.specDigest === child.specDigest;
}

function roadmapApprovalMatches(child: Run, authority: RoadmapAuthority): boolean {
  return child.approval?.kind === 'roadmap' && matchesAuthority(child.approval, authority);
}

function prefix<T>(previous: T[], next: T[]): boolean {
  return previous.length <= next.length && previous.every((entry, index) => equal(entry, next[index]));
}

function prefixBlocks(previous: RunSpec['blocks'], next: RunSpec['blocks']): boolean {
  return previous.length <= next.length && previous.every((block, index) => {
    const candidate = next[index];
    return candidate?.id === block.id && candidate.goal === block.goal && candidate.review === block.review && prefix(block.scope, candidate.scope) && prefix(block.criteria, candidate.criteria) && prefix(block.checks, candidate.checks) && prefix(block.dependsOn ?? [], candidate.dependsOn ?? []);
  });
}

function equal(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function digestValue(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function timestamp(value: unknown): boolean { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
