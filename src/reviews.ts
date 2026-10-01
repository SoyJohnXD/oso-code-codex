import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validCheck } from './checks.ts';
import { activeBlock, assertScope, event, requireAuthorization } from './lifecycle.ts';
import { digest, fileModes, scopeMatches, snapshot } from './project.ts';
import { recordFailure } from './recovery.ts';
import { readRun, selectRun, stateDirectory } from './store.ts';
import { ownershipChanges } from './parking.ts';
import { familyBoundary } from './boundaries.ts';
import { recordRecoveryProgress, recoveryStatus, revokeFindingProgress } from './recovery-control.ts';
import { configurationCovers, configurationTier, sameConfiguration, sameModelConfiguration, tierRank } from './model-policy.ts';
import { childSatisfiesRoadmap, roadmapParentId } from './roadmap-lineage.ts';
import type { AgentRecord, BlockSpec, BlockState, Finding, ImplementationContribution, ModelConfiguration, Review, Run } from './types.ts';

type AgentAssignment = Omit<AgentRecord, 'status' | 'block' | 'requestedConfiguration' | 'observedConfiguration' | 'observations' | 'replacementFor'> & { configuration?: ModelConfiguration; observation?: ModelConfiguration; replaces?: string };
type ExistingObservation = { id: string; observation: ModelConfiguration };

export function registerAgent(run: Run, assignment: AgentAssignment | ExistingObservation, final = false): void {
  requireAuthorization(run);
  const truthful = Boolean(run.spec.coordination || run.spec.reviewFallback);
  const previous = run.agents.find(agent => agent.id === assignment.id);
  if (assignment.observation && previous && Object.keys(assignment).every(key => key === 'id' || key === 'observation')) {
    if (!truthful) throw new Error('Observed model configuration requires a truthful-accounting adoption');
    if (!validConfiguration(assignment.observation)) throw new Error('Observed configuration requires model and reasoningEffort');
    (previous.observations ??= []).push({ at: new Date().toISOString(), configuration: assignment.observation });
    previous.observedConfiguration = assignment.observation;
    event(run, 'agent-observation', assignment.id);
    return;
  }
  if (!['plan', 'roadmap'].includes(run.spec.mode)) final = false;
  const block = final ? undefined : activeBlock(run).block;
  const launch = assignment as AgentAssignment;
  if (!truthful && (launch.configuration || launch.observation || launch.replaces)) throw new Error('Model configuration and replacement history require a truthful-accounting adoption');
  if (block && launch.role === 'applier') {
    const recovery = recoveryStatus(run);
    if (!recovery.canCorrect) throw new Error(recovery.pause?.next ?? run.next);
  }
  if (final && launch.role !== 'reviewer') throw new Error('Cumulative closure only delegates independent review');
  if (!launch.id.trim() || launch.id === run.spec.principal) throw new Error('Use the native child agent identity');
  if (launch.configuration && !validNativeConfiguration(launch.configuration) || launch.observation && !validConfiguration(launch.observation)) throw new Error('Requested configuration requires model, reasoningEffort and forkTurns:none; observed configuration requires model and reasoningEffort');
  if (launch.observation && !previous) throw new Error('Observed configuration must extend an existing native identity');
  if (previous && previous.status !== 'finished') throw new Error('Agent is still registered as running; reconcile its native handle before follow-up');
  if (previous && previous.role !== launch.role) throw new Error('An existing native agent cannot silently change roles');
  if (!(block?.contributions || final && run.blocks.some(entry => entry.contributions)) && !launch.tier) throw new Error('Legacy native assignments require their actual model tier');
  if (previous?.requestedConfiguration && launch.configuration && !sameConfiguration(previous.requestedConfiguration, launch.configuration)) throw new Error('An existing native agent cannot silently change its original launch configuration');
  if (launch.replaces) {
    const replaced = run.agents.find(agent => agent.id === launch.replaces);
    if (!replaced || replaced.status !== 'finished' || replaced.role !== launch.role || launch.replaces === launch.id) throw new Error('A replacement must retain a completed same-role native assignment');
  }
  const failureKey = block?.failure ? digest(JSON.stringify([block.id, block.failure, block.rounds.length])) : undefined;
  if (failureKey && run.agents.some(agent => agent.id !== launch.id && agent.role === launch.role && agent.failureKey === failureKey)) throw new Error('This unresolved failure already has a native agent for that role; recover its result instead of launching a replacement');
  const maximum = run.spec.coordination?.maxActiveAgents ?? 2;
  if (run.agents.filter(agent => agent.status !== 'finished').length >= maximum) throw new Error(run.spec.coordination ? 'configured child capacity is full; reconcile a native handle before launching another child' : 'Maximum two concurrent child agents; no recursive delegation');
  if (launch.role === 'applier') {
    const overlaps = run.agents.some(agent => agent.status !== 'finished' && agent.role === 'applier' && scopesOverlap(agent.scope, launch.scope));
    if (overlaps) throw new Error('A writer still owns this scope; reconcile it before replacement');
    if (!block!.contributions) {
      if (!block!.writers.includes(launch.id)) block!.writers.push(launch.id);
      if (!block!.implementationTier || tierRank(launch.tier!) > tierRank(block!.implementationTier)) block!.implementationTier = launch.tier!;
    }
  }
  const registered: AgentRecord = { id: launch.id, role: launch.role, ...(launch.tier ? { tier: launch.tier } : {}), scope: launch.scope, block: block?.id ?? 'final', status: 'running', failureKey, ...(truthful && launch.configuration ? { requestedConfiguration: launch.configuration } : {}), ...(truthful && launch.replaces ? { replacementFor: launch.replaces } : {}) };
  if (previous) {
    if (launch.observation) (previous.observations ??= []).push({ at: new Date().toISOString(), configuration: launch.observation });
    Object.assign(previous, registered, { requestedConfiguration: previous.requestedConfiguration ?? launch.configuration, observedConfiguration: launch.observation ?? previous.observedConfiguration, observations: previous.observations, result: undefined });
  }
  else run.agents.push(registered);
  if (truthful) {
    const target = previous ?? registered;
    (target.assignments ??= []).push({ at: new Date().toISOString(), block: registered.block, scope: [...registered.scope], ...(target.requestedConfiguration ? { requestedConfiguration: target.requestedConfiguration } : {}), ...(target.observedConfiguration ? { observedConfiguration: target.observedConfiguration } : {}), ...(registered.replacementFor ? { replacementFor: registered.replacementFor } : {}) });
  }
  event(run, 'agent-start', `${launch.id}: ${launch.role}/${launch.tier ?? launch.configuration?.model ?? 'unconfigured'}`);
}

export function recordContribution(run: Run, value: unknown): void {
  const { block, specification } = activeBlock(run);
  if (!block.contributions) throw new Error('Implementation contributions are available only for truthful-accounting blocks');
  const contribution = contributionInput(value);
  if (!contribution.scope.every(entry => specification.scope.some(approved => coversScope(approved, entry)))) throw new Error('Contribution scope must stay within the active block scope');
  const agent = run.agents.find(entry => entry.id === contribution.actor);
  if (contribution.actor !== run.spec.principal && (!agent || agent.role !== 'applier' || agent.block !== block.id || agent.status !== 'finished' || !agent.result || !contribution.scope.every(entry => agent.scope.some(assigned => coversScope(assigned, entry))))) throw new Error('Applier contributions require that agent’s explicit delivered completed assignment and assigned scope');
  if (contribution.actor === run.spec.principal && contribution.configuration) throw new Error('Principal model provenance requires observation --file; remove configuration from the contribution payload');
  const configuration = contribution.configuration ?? agent?.observedConfiguration ?? agent?.requestedConfiguration;
  if (contribution.configuration && agent?.requestedConfiguration && !sameModelConfiguration(contribution.configuration, agent.observedConfiguration ?? agent.requestedConfiguration)) throw new Error('Applier contribution configuration must match the native assignment');
  const recorded: ImplementationContribution = { ...contribution, ...(configuration ? { configuration } : {}), at: new Date().toISOString() };
  if (block.contributions.some(entry => entry.actor === recorded.actor && entry.evidence === recorded.evidence && JSON.stringify(entry.scope) === JSON.stringify(recorded.scope))) return;
  block.contributions.push(recorded);
  if (!block.writers.includes(recorded.actor)) block.writers.push(recorded.actor);
  const tier = configurationTier(configuration);
  if (tier && (!block.implementationTier || tierRank(tier) > tierRank(block.implementationTier))) block.implementationTier = tier;
  event(run, 'contribution', recorded.actor);
}

export function recordObservation(run: Run, value: unknown): void {
  const input = observationInput(value);
  if (!run.spec.coordination && !run.spec.reviewFallback) throw new Error('Observed model configuration requires a truthful-accounting adoption');
  if (input.actor !== run.spec.principal) {
    registerAgent(run, { id: input.actor, observation: input.observation });
    return;
  }
  requireAuthorization(run, 'metadata');
  (run.principalObservations ??= []).push({ at: new Date().toISOString(), configuration: input.observation });
  event(run, 'principal-observation', run.spec.principal);
}

export function finishAgent(run: Run, id: string, report: string): void {
  const agent = run.agents.find(entry => entry.id === id);
  if (!agent) throw new Error('Unknown native agent handle');
  if (!report.trim()) throw new Error('Read the native result before marking delivery complete');
  if (agent.status === 'finished' && agent.result === report) return;
  agent.status = 'finished';
  agent.result = report;
  (agent.deliveries ??= []).push({ at: new Date().toISOString(), report });
  event(run, 'agent-result', id);
}

export function recordReview(run: Run, input: Pick<Review, 'agent' | 'criteria' | 'verdict' | 'kind'>, final = false): Review {
  requireAuthorization(run);
  if (!['plan', 'roadmap'].includes(run.spec.mode)) final = false;
  const agent = run.agents.find(entry => entry.id === input.agent);
  const block = final ? undefined : activeBlock(run).block;
  const specification = final ? undefined : activeBlock(run).specification;
  const writers = final ? run.blocks.flatMap(entry => entry.writers) : block!.writers;
  const implementationTier = final ? Math.max(...run.blocks.map(entry => tierRank(entry.implementationTier ?? 'luna'))) : tierRank(block!.implementationTier ?? 'luna');
  if (!agent || agent.role !== 'reviewer' || agent.status !== 'finished' || !agent.result || writers.includes(input.agent)) throw new Error('Review needs a delivered result from a registered independent native reviewer');
  const truthful = final ? run.blocks.some(entry => Boolean(entry.contributions)) : Boolean(block!.contributions);
  if (!truthful && (!agent.tier || tierRank(agent.tier) < implementationTier)) throw new Error('Reviewer tier must cover the implementation tier');
  const coverage = input.verdict === 'pass' ? final ? finalCoverage(run, agent) : blockCoverage(run, block!, agent, specification!) : undefined;
  if (!final && agent.block !== block!.id) throw new Error('Reviewer assignment belongs to another block');
  const expected = final ? ['rubric', 'conformance'] : specification!.criteria;
  if (input.verdict === 'pass' && expected.some(criterion => !input.criteria.includes(criterion))) throw new Error('Review is missing required criteria; recover substantive evidence without relaunching for formatting');
  const ids = final ? [...new Set(run.spec.blocks.flatMap(entry => entry.checks))] : specification!.checks;
  const cache = new Map();
  const checks = ids.map(id => validCheck(run, id, cache));
  if (input.verdict === 'pass' && checks.some(check => !check)) throw new Error('A required check is incomplete, stale or failed');
  const scope = final ? run.spec.blocks.flatMap(entry => entry.scope) : specification!.scope;
  if (run.blocks.some(entry => entry.contributions?.some(contribution => contribution.actor === input.agent && scopesOverlap(contribution.scope, scope)))) throw new Error('A reviewer cannot attest to a scope they implemented');
  if (!scope.every(requested => agent.scope.some(assigned => coversScope(assigned, requested)))) throw new Error('Reviewer assignment does not cover the required scope; obtain focused coverage before recording a pass');
  const id = randomUUID();
  const directory = path.join(stateDirectory(run.project), 'reviews', run.spec.id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const report = path.join(directory, `${id}.txt`);
  writeFileSync(report, agent.result, { mode: 0o600, flag: 'wx' });
  const reviewFiles = snapshot(run.project, scope);
  const review: Review = { ...input, id, ...(agent.tier ? { tier: agent.tier } : {}), scopeDigest: digest(JSON.stringify(reviewFiles)), scopeModes: fileModes(run.project, reviewFiles), checkAttempts: checks.flatMap(check => check ? [check.attempt] : []), report, reportDigest: digest(agent.result), ...(coverage ? { coverage } : {}) };
  (final ? run.finalReviews : block!.reviews).push(review);
  if (input.verdict !== 'pass' && run.activeBlock) recordFailure(run, input.verdict === 'blocked' ? 'delivery' : 'product', `Reviewer ${input.agent}: ${input.verdict}; inspect ${report}`);
  event(run, 'review', `${id}: ${input.verdict}`);
  return review;
}

export function upsertFinding(run: Run, finding: Finding): void {
  const { block } = activeBlock(run);
  if (!finding.id?.trim() || !finding.rule?.trim() || !finding.evidence?.trim()) throw new Error('Finding needs id, rule and concrete code evidence');
  if (!['open', 'fixed', 'false-positive'].includes(finding.disposition)) throw new Error('No residual waiver exists for a real rubric violation');
  if (finding.disposition !== 'open' && !finding.resolution?.trim()) throw new Error('Resolution needs a code fix or evidence disproving the claimed violation');
  const existing = block.findings.find(entry => entry.id === finding.id);
  const resolved = existing?.disposition === 'open' && finding.disposition !== 'open';
  if (existing && existing.disposition !== 'open' && finding.disposition === 'open') revokeFindingProgress(run, finding.id);
  if (existing) Object.assign(existing, finding);
  else block.findings.push(finding);
  if (resolved) recordRecoveryProgress(run, { kind: 'finding', id: finding.id });
  event(run, 'finding', `${finding.id}: ${finding.disposition} ${finding.resolution ?? finding.evidence}`);
}

export function closeBlock(run: Run): Review {
  const { block, specification } = activeBlock(run);
  if (block.failure || block.status === 'blocked') throw new Error(run.next);
  if (run.agents.some(agent => agent.status !== 'finished')) throw new Error('Reconcile outstanding native agents before closure');
  if (block.findings.some(finding => finding.disposition === 'open')) throw new Error('Unresolved rubric or conformance findings prevent closure');
  assertScope(run, block, specification);
  const review = currentBlockReview(run, block, specification);
  block.closedSnapshot = snapshot(run.project, specification.scope);
  block.closedModes = fileModes(run.project, block.closedSnapshot);
  block.closedDeletions = Object.keys(block.baseline ?? {}).filter(filename => scopeMatches(filename, specification.scope) && block.closedSnapshot![filename] === undefined);
  block.status = 'closed';
  delete block.externalFulfillment;
  delete run.activeBlock;
  run.next = run.blocks.some(entry => entry.status !== 'closed') ? 'Activate the next approved block' : ['plan', 'roadmap'].includes(run.spec.mode) ? 'Perform cumulative independent debt/conformance review, then close' : 'Close the run; the combined independent review is complete';
  event(run, 'block-close', block.id);
  return review;
}

export function currentBlockReview(run: Run, block: BlockState, specification: BlockSpec): Review {
  const current = digest(JSON.stringify(snapshot(run.project, specification.scope)));
  const reviewedModes = fileModes(run.project, snapshot(run.project, specification.scope));
  const candidates = block.reviews.filter(entry => entry.verdict === 'pass' && entry.kind === (specification.review ?? 'general') && specification.criteria.every(criterion => entry.criteria.includes(criterion)) && entry.scopeDigest === current && digest(readFileSync(entry.report)) === entry.reportDigest);
  const review = candidates.findLast(entry => digest(JSON.stringify(entry.scopeModes)) === digest(JSON.stringify(reviewedModes)));
  if (!review) throw new Error('A current independent review with Git mode provenance is required before committing this block');
  const reviewer = run.agents.find(agent => agent.id === review.agent);
  if (!reviewer) throw new Error('A current independent native reviewer is required before committing this block');
  blockCoverage(run, block, reviewer, specification);
  const cache = new Map();
  for (const id of specification.checks) {
    const check = validCheck(run, id, cache);
    if (!check || !review.checkAttempts.includes(check.attempt)) throw new Error(`Check ${id} needs current executed evidence covered by the review`);
  }
  return review;
}

export function closeRun(run: Run): void {
  requireAuthorization(run);
  if (['commit', 'publication'].some(action => familyBoundary(run, action as 'commit' | 'publication')?.status === 'open')) throw new Error('A required delivery action remains blocked; resolve its recorded boundary before closing');
  if (run.blocks.some(block => block.status !== 'closed')) throw new Error('Every approved block must be closed');
  if (run.agents.some(agent => agent.status !== 'finished')) throw new Error('Native agents still need reconciliation');
  for (const child of run.spec.children ?? []) {
    const record = readRun(run.project, child.id);
    if (record.status !== 'closed' || !childSatisfiesRoadmap(run, child, record)) throw new Error(`Roadmap child remains incomplete: ${child.id}`);
  }
  const scope = run.spec.blocks.flatMap(block => block.scope);
  const outside = ownershipChanges(run, run.baseline, run.baselineModes, run.baseHead).filter(filename => !scopeMatches(filename, scope));
  if (outside.length) throw new Error(`Changes outside approved run scope need reconciliation: ${outside.join(', ')}`);
  const cache = new Map();
  const checks = [...new Set(run.spec.blocks.flatMap(block => block.checks))].map(id => validCheck(run, id, cache));
  if (checks.some(check => !check)) throw new Error('A required check is stale or incomplete');
  const current = digest(JSON.stringify(snapshot(run.project, scope)));
  if (run.spec.mode === 'plan' || run.spec.mode === 'roadmap') {
    const currentModes = fileModes(run.project, snapshot(run.project, scope));
    const final = run.finalReviews.findLast(review => digest(JSON.stringify(review.scopeModes)) === digest(JSON.stringify(currentModes)) && review.verdict === 'pass' && review.scopeDigest === current && checks.every(check => review.checkAttempts.includes(check!.attempt)) && digest(readFileSync(review.report)) === review.reportDigest);
    if (!final) throw new Error('Cumulative independent debt and conformance review is required');
    const reviewer = run.agents.find(agent => agent.id === final.agent);
    if (!reviewer) throw new Error('Cumulative independent review needs its registered native reviewer');
    finalCoverage(run, reviewer);
  } else {
    for (const block of run.blocks.filter(block => run.spec.blocks.some(specification => specification.id === block.id))) {
      const specification = run.spec.blocks.find(entry => entry.id === block.id)!;
      if (digest(JSON.stringify(block.closedSnapshot)) !== digest(JSON.stringify(snapshot(run.project, specification.scope)))) throw new Error(`Code changed after review of ${block.id}`);
      if (!block.closedModes) throw new Error(`Closed checkpoint ${block.id} lacks Git mode provenance; reconcile with a focused current review`);
      const currentModes = fileModes(run.project, snapshot(run.project, specification.scope));
      if (digest(JSON.stringify(block.closedModes)) !== digest(JSON.stringify(currentModes))) throw new Error(`Git mode changed after review of ${block.id}`);
    }
  }
  run.status = 'closed';
  run.next = 'Complete. Report the result, verification and any deployment boundary.';
  event(run, 'close', run.spec.objective);
  const parent = roadmapParentId(run);
  if (parent) selectRun(readRun(run.project, parent));
}

function scopesOverlap(left: string[], right: string[]): boolean {
  return left.some(pattern => right.some(other => scopeMatches(pattern, [other]) || scopeMatches(other, [pattern]) || pattern.includes('*') || other.includes('*')));
}

export function coversScope(assigned: string, requested: string): boolean {
  if (assigned === requested || assigned === '.' || assigned === '**') return true;
  const directory = assigned.endsWith('/**') ? assigned.slice(0, -3) : assigned;
  if (!directory.includes('*') && !directory.includes('?')) return scopeMatches(requested, [directory]);
  return !requested.includes('*') && !requested.includes('?') && scopeMatches(requested, [assigned]);
}

function contributionInput(value: unknown): Omit<ImplementationContribution, 'at'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Contribution must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['actor', 'scope', 'evidence', 'configuration'].includes(key)) || typeof input.actor !== 'string' || !input.actor.trim() || !Array.isArray(input.scope) || !input.scope.length || !input.scope.every(entry => typeof entry === 'string' && entry.trim()) || typeof input.evidence !== 'string' || !input.evidence.trim()) throw new Error('Contribution requires actor, nonempty scope and explicit evidence');
  if (input.configuration !== undefined && !validConfiguration(input.configuration)) throw new Error('Contribution configuration requires model and reasoningEffort');
  return { actor: input.actor as string, scope: input.scope as string[], evidence: input.evidence as string, ...(input.configuration ? { configuration: input.configuration as ModelConfiguration } : {}) };
}

function blockCoverage(run: Run, block: BlockState, reviewer: AgentRecord, specification: BlockSpec) {
  if (!block.contributions) return undefined;
  const configuration = reviewer.observedConfiguration ?? reviewer.requestedConfiguration;
  const legacyFallback = Boolean(block.unattributedWriters?.length);
  if (legacyFallback && (!run.spec.reviewFallback || !configurationCovers(configuration, run.spec.reviewFallback))) throw new Error('Legacy implementation authors have unknown configuration; the approved review fallback is required');
  if (!block.contributions.length) {
    if (legacyFallback) {
      return { ...(reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}), ...(reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}), fallback: run.spec.reviewFallback };
    }
    if (scopeChangedWithoutContribution(run, block, specification)) throw new Error('Truthful closure requires an actual implementation contribution');
    return { ...(reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}), ...(reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}) };
  }
  let usesFallback = legacyFallback;
  for (const contribution of block.contributions) {
    const contributed = effectiveContributionConfiguration(run, block, contribution);
    if (contributed && configurationCovers(configuration, contributed)) continue;
    if (!configurationTier(contributed) && run.spec.reviewFallback && configurationCovers(configuration, run.spec.reviewFallback)) {
      usesFallback = true;
      continue;
    }
    throw new Error('Reviewer configuration does not cover the actual implementation; unknown principal work needs the approved review fallback');
  }
  return { ...(reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}), ...(reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}), ...(usesFallback ? { fallback: run.spec.reviewFallback } : {}) };
}

function effectiveContributionConfiguration(run: Run, block: BlockState, contribution: ImplementationContribution): ModelConfiguration | undefined {
  if (contribution.actor === run.spec.principal) return run.principalObservations?.at(-1)?.configuration;
  const agent = run.agents.find(entry => entry.id === contribution.actor);
  if (agent?.observedConfiguration || agent?.requestedConfiguration) return agent.observedConfiguration ?? agent.requestedConfiguration;
  return block.contributions!.findLast(entry => entry.actor === contribution.actor && entry.configuration)?.configuration;
}

function finalCoverage(run: Run, reviewer: AgentRecord) {
  const coverage = run.blocks.map(block => blockCoverage(run, block, reviewer, run.spec.blocks.find(specification => specification.id === block.id)!));
  return coverage.some(Boolean)
    ? { ...(reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}), ...(reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}), ...(coverage.some(entry => entry?.fallback) ? { fallback: run.spec.reviewFallback } : {}) }
    : undefined;
}

function scopeChangedWithoutContribution(run: Run, block: BlockState, specification: BlockSpec): boolean {
  const current = snapshot(run.project, specification.scope);
  const names = new Set([...Object.keys(block.baseline ?? {}), ...Object.keys(current)]);
  return [...names].some(filename => scopeMatches(filename, specification.scope) && block.baseline?.[filename] !== current[filename]);
}

function validConfiguration(value: unknown): value is ModelConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const configuration = value as Record<string, unknown>;
  return Object.keys(configuration).every(key => key === 'model' || key === 'reasoningEffort' || key === 'forkTurns') && typeof configuration.model === 'string' && Boolean(configuration.model.trim()) && typeof configuration.reasoningEffort === 'string' && Boolean(configuration.reasoningEffort.trim()) && (configuration.forkTurns === undefined || configuration.forkTurns === 'none');
}

function validNativeConfiguration(value: unknown): value is ModelConfiguration {
  return validConfiguration(value) && value.forkTurns === 'none';
}

function observationInput(value: unknown): { actor: string; observation: ModelConfiguration } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Observation must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'actor' && key !== 'observation') || typeof input.actor !== 'string' || !input.actor.trim() || !validConfiguration(input.observation)) throw new Error('Observation requires actor plus observed model and reasoningEffort');
  return { actor: input.actor, observation: input.observation as ModelConfiguration };
}
