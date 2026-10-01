import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertAutoRecoveryPolicy } from './schema.ts';
import { hasValidRoadmapLineage } from './roadmap-lineage.ts';
import { sameConfiguration } from './model-policy.ts';
import { scopeMatches } from './project.ts';
import type { AgentRecord, BlockState, ProcessIdentity, Run } from './types.ts';

export function stateDirectory(project: string): string {
  return path.join(project, '.oso-code-codex');
}

export function initializeStore(project: string): void {
  const directory = stateDirectory(project);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(directory, 'runs'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, '.gitignore'), '*\n');
}

export function readRun(project: string, id?: string): Run {
  const directory = stateDirectory(project);
  const selected = id ?? readFileSync(path.join(directory, 'active'), 'utf8').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(selected)) throw new Error('Invalid run id');
  const current = path.join(directory, 'runs', `${selected}.json`);
  const run = JSON.parse(readFileSync(existsSync(current) ? current : path.join(directory, `${selected}.json`), 'utf8')) as Run;
  if ((run.version !== 1 && run.version !== 2 && run.version !== 3 && run.version !== 4 && run.version !== 5) || run.project !== project) throw new Error('Unsupported or mismatched run record; no migration was applied');
  if (run.readerMinimumVersion && (run.readerMinimumVersion > 5 || run.readerMinimumVersion > run.version)) throw new Error(`Run requires runtime reader version ${run.readerMinimumVersion}; no migration was applied`);
  assertRecoveryRecord(run);
  assertExternalFulfillments(run);
  assertTruthfulAccountingRecord(run);
  if (run.roadmapLineage && !hasValidRoadmapLineage(run)) throw new Error('Roadmap lineage is malformed or discontinuous; no migration was applied');
  return run;
}

export function listRuns(project: string): Run[] {
  const directory = stateDirectory(project);
  const records = path.join(directory, 'runs');
  const ids = new Set(existsSync(records) ? readdirSync(records).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)) : []);
  if (existsSync(path.join(directory, 'active'))) ids.add(readFileSync(path.join(directory, 'active'), 'utf8').trim());
  return [...ids].sort().map(id => readRun(project, id));
}

export function writeRun(run: Run): void {
  assertRecoveryRecord(run);
  assertExternalFulfillments(run);
  assertTruthfulAccountingRecord(run);
  mkdirSync(path.join(stateDirectory(run.project), 'runs'), { recursive: true, mode: 0o700 });
  run.updated = new Date().toISOString();
  atomicWrite(path.join(stateDirectory(run.project), 'runs', `${run.spec.id}.json`), JSON.stringify(run, null, 2) + '\n');
}

export function selectRun(run: Run): void {
  atomicWrite(path.join(stateDirectory(run.project), 'active'), `${run.spec.id}\n`);
}

export function transaction<T>(project: string, action: () => T): T {
  const release = acquireLock(path.join(stateDirectory(project), 'transaction.lock'));
  try { return action(); } finally { release(); }
}

export function acquireLock(directory: string): () => void {
  mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  try { mkdirSync(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const ownerPath = path.join(directory, 'owner.json');
    if (!existsSync(ownerPath)) throw new Error(`Lock is initializing or requires inspection: ${directory}`);
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as ProcessIdentity;
    if (processAlive(owner)) throw new Error(`Resource is busy (pid ${owner.pid}): ${directory}`);
    rmSync(directory, { recursive: true });
    mkdirSync(directory);
  }
  const token = randomUUID();
  writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ ...processIdentity(process.pid), token }));
  return () => {
    if (!existsSync(directory)) return;
    const current = JSON.parse(readFileSync(path.join(directory, 'owner.json'), 'utf8')) as { token: string };
    if (current.token === token) rmSync(directory, { recursive: true });
  };
}

export function processIdentity(pid: number): ProcessIdentity {
  if (process.platform !== 'linux') return { pid };
  const namespace = readlinkSync('/proc/self/ns/pid');
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { pid, namespace, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pid, namespace };
    throw error;
  }
}

export function processAlive(identity: ProcessIdentity): boolean {
  if (process.platform === 'linux' && identity.namespace !== readlinkSync('/proc/self/ns/pid')) return true;
  try { process.kill(identity.pid, 0); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
  }
  return !identity.start || processIdentity(identity.pid).start === identity.start;
}

export function requireStoppedIdentity(identity: ProcessIdentity): void {
  if (process.platform === 'linux' && identity.namespace !== readlinkSync('/proc/self/ns/pid')) return;
  if (processAlive(identity)) throw new Error(`Owned process ${identity.pid} is visibly still alive; wait on its native handle`);
}

export function releaseStoppedCheckLocks(project: string, owner: ProcessIdentity, sharedLocks?: string): void {
  const directory = stateDirectory(project);
  const locks = path.join(directory, 'locks');
  const candidates = [path.join(directory, 'transaction.lock'), ...(existsSync(locks) ? readdirSync(locks).map(name => path.join(locks, name)) : []), ...(sharedLocks && existsSync(sharedLocks) ? readdirSync(sharedLocks).map(name => path.join(sharedLocks, name)) : [])];
  for (const candidate of candidates) {
    const filename = path.join(candidate, 'owner.json');
    if (!existsSync(filename)) continue;
    const current = JSON.parse(readFileSync(filename, 'utf8')) as ProcessIdentity;
    if (current.pid === owner.pid && current.start === owner.start && current.namespace === owner.namespace) rmSync(candidate, { recursive: true });
  }
}

export function atomicWrite(filename: string, content: string): void {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, filename);
}

function assertRecoveryRecord(run: Run): void {
  if (run.version < 3 && (run.recovery !== undefined || run.recoveryControl !== undefined)) throw new Error('Recovery policy requires a version 3 run record; no migration was applied');
  if (run.version < 3) return;
  const hasFulfillment = run.version >= 4 && run.blocks.some(block => block.externalFulfillments?.length);
  const hasLineage = run.version === 5 && run.roadmapLineage !== undefined;
  const hasTruthfulAccounting = run.version === 5 && (run.spec.coordination !== undefined || run.spec.reviewFallback !== undefined);
  if (run.readerMinimumVersion !== run.version || !run.recovery && !run.recoveryControl && !hasFulfillment && !hasLineage && !hasTruthfulAccounting) throw new Error(`Version ${run.version} run record is missing its recovery, external fulfillment, roadmap lineage or truthful-accounting state; no migration was applied`);
  if (run.recovery) assertRecoveryState(run);
  if (run.recoveryControl) assertRecoveryControl(run);
}

function assertRecoveryState(run: Run): void {
  const recovery = run.recovery!;
  if (!identifier(recovery.owner) || !digest(recovery.specDigest) || recovery.initialLimit !== undefined && !positive(recovery.initialLimit) || recovery.adoptedUsed !== undefined && !nonnegative(recovery.adoptedUsed)) throw new Error('Version 3 recovery policy state is malformed; no migration was applied');
  if (run.spec.id !== recovery.owner && (recovery.initialLimit !== undefined || recovery.adoptedUsed !== undefined || recovery.grants?.length)) throw new Error('Only the recovery owner may store recovery grants; no migration was applied');
  if (recovery.grants !== undefined && !Array.isArray(recovery.grants)) throw new Error('Version 3 recovery grants are malformed; no migration was applied');
  for (const grant of recovery.grants ?? []) {
    const authorization = grant?.authorization;
    if (!positive(grant?.additionalCorrections) || !authorization || authorization.kind !== 'user' || !text(authorization.reference) || !text(authorization.message) || authorization.specDigest !== recovery.specDigest) throw new Error('Version 3 recovery grant is malformed; no migration was applied');
  }
  if (run.version === 3 && (recovery.policy !== undefined || recovery.policySource !== undefined || recovery.adoptions !== undefined)) throw new Error('Version 3 recovery policy cannot contain auto policy state; no migration was applied');
  if (run.version < 4) return;
  if (run.spec.id !== recovery.owner) {
    if (recovery.policy !== undefined || recovery.policySource !== undefined || recovery.adoptions !== undefined) throw new Error('Only the recovery owner may store auto recovery policy state; no migration was applied');
    return;
  }
  if (recovery.policy === undefined && recovery.policySource === undefined && recovery.adoptions === undefined && run.spec.recovery?.mode !== 'auto') return;
  assertAutoRecoveryPolicy(recovery.policy, 'Version 4 auto recovery policy state is malformed; no migration was applied: ');
  if (!['spec', 'adoption'].includes(recovery.policySource ?? '') || !Array.isArray(recovery.adoptions)) throw new Error('Version 4 auto recovery policy state is malformed; no migration was applied');
  for (const adoption of recovery.adoptions) {
    assertAutoRecoveryPolicy(adoption?.policy, 'Version 4 recovery adoption is malformed; no migration was applied: ');
    const authorization = adoption?.authorization;
    if (!authorization || authorization.kind !== 'user' || !text(authorization.reference) || !text(authorization.message) || authorization.specDigest !== recovery.specDigest || !timestamp(adoption.at)) throw new Error('Version 4 recovery adoption is malformed; no migration was applied');
  }
  const declared = recovery.policySource === 'spec' ? run.spec.recovery : recovery.adoptions.at(-1)?.policy;
  if (declared?.mode !== 'auto' || declared.maxCorrections !== recovery.policy.maxCorrections || recovery.policySource === 'spec' && recovery.adoptions.length > 0) throw new Error('Version 4 auto recovery policy does not match its declared source; no migration was applied');
}

function assertRecoveryControl(run: Run): void {
  const control = run.recoveryControl!;
  if (!Array.isArray(control.strategies) || !Array.isArray(control.progress)) throw new Error('Version 3 recovery control state is malformed; no migration was applied');
  for (const strategy of control.strategies) {
    const diagnosis = strategy?.diagnosis;
    if (!identifier(strategy?.block) || !digest(strategy?.failureKey) || !nonnegative(strategy?.round) || !diagnosis || !text(diagnosis.agent) || !text(diagnosis.report) || !texts(diagnosis.evidence) || diagnosis.delivery && (!timestamp(diagnosis.delivery.at) || !text(diagnosis.delivery.report)) || !text(strategy.approach) || !timestamp(strategy.at) || strategy.progress && !validComparableProgress(strategy.progress)) throw new Error('Version 3 recovery strategy is malformed; no migration was applied');
  }
  for (const progress of control.progress) {
    if (!progress || !['check', 'finding'].includes(progress.kind) || !identifier(progress.block) || !nonnegative(progress.round) || !timestamp(progress.at) || progress.revokedAt !== undefined && (run.version < 4 || !timestamp(progress.revokedAt)) || progress.kind === 'check' && !text(progress.attempt) || progress.kind === 'finding' && (!text(progress.id) || !text(progress.evidence) || !text(progress.resolution))) throw new Error('Recovery progress is malformed or uses unsupported revocation state; no migration was applied');
  }
}

function assertTruthfulAccountingRecord(run: Run): void {
  const enabled = run.spec.coordination !== undefined || run.spec.reviewFallback !== undefined;
  if (!enabled) {
    if (truthfulMetadata(run)) throw new Error('Truthful accounting metadata requires a version 5 approved adoption; no migration was applied');
    if (run.version === 5 && !run.roadmapLineage) throw new Error('Version 5 run record lacks complete roadmap lineage or truthful-accounting state; no migration was applied');
    return;
  }
  if (run.version !== 5 || run.readerMinimumVersion !== 5) throw new Error('Truthful accounting requires a complete version 5 run record; no migration was applied');
  if (run.spec.coordination && (!positive(run.spec.coordination.maxActiveAgents) || Object.keys(run.spec.coordination).some(key => key !== 'maxActiveAgents'))) throw new Error('Truthful accounting coordination is malformed; no migration was applied');
  if (run.spec.reviewFallback && !modelConfiguration(run.spec.reviewFallback)) throw new Error('Truthful accounting review fallback is malformed; no migration was applied');
  if (new Set(run.blocks.map(block => block.id)).size !== run.blocks.length || run.blocks.some(block => !run.spec.blocks.some(specification => specification.id === block.id))) throw new Error('Truthful accounting blocks are not linked to the approved specification; no migration was applied');
  for (const block of run.blocks) {
    if (!Array.isArray(block.contributions)) throw new Error('Truthful accounting blocks require retained contribution history; no migration was applied');
    if (block.unattributedWriters !== undefined && !texts(block.unattributedWriters)) throw new Error('Truthful accounting legacy authors are malformed; no migration was applied');
    for (const contribution of block.contributions) {
      if (!text(contribution?.actor) || !texts(contribution?.scope) || !text(contribution?.evidence) || !timestamp(contribution?.at) || contribution.configuration !== undefined && !modelConfiguration(contribution.configuration)) throw new Error('Truthful accounting contribution is malformed; no migration was applied');
      if (!contributionActor(run, block, contribution)) throw new Error('Truthful accounting contribution lacks its delivered assigned native author; no migration was applied');
    }
    if (!completeWriters(block)) throw new Error('Truthful accounting writers omit or invent retained authors; no migration was applied');
  }
  for (const agent of run.agents) {
    if (agent.requestedConfiguration !== undefined && !nativeConfiguration(agent.requestedConfiguration) || agent.observedConfiguration !== undefined && !modelConfiguration(agent.observedConfiguration) || agent.observations !== undefined && (!Array.isArray(agent.observations) || agent.observations.some(observation => !timestamp(observation?.at) || !modelConfiguration(observation?.configuration)))) throw new Error('Truthful accounting native configuration is malformed; no migration was applied');
    if (!agentAssignments(run, agent)) throw new Error('Truthful accounting native assignment history is malformed; no migration was applied');
  }
  if (run.principalObservations !== undefined && (!Array.isArray(run.principalObservations) || run.principalObservations.some(observation => !timestamp(observation?.at) || !modelConfiguration(observation?.configuration)))) throw new Error('Truthful accounting principal observation is malformed; no migration was applied');
}

function truthfulMetadata(run: Run): boolean {
  return run.principalObservations !== undefined || run.blocks.some(block => block.contributions !== undefined || block.unattributedWriters !== undefined) || run.agents.some(agent => agent.requestedConfiguration !== undefined || agent.observedConfiguration !== undefined || agent.observations !== undefined || agent.replacementFor !== undefined || agent.assignments !== undefined);
}

function contributionActor(run: Run, block: BlockState, contribution: { actor: string; scope: string[] }): boolean {
  if (contribution.actor === run.spec.principal) return contribution.scope.every(scope => scopeCoveredBy(blockScope(run, block), scope));
  const agent = run.agents.find(entry => entry.id === contribution.actor);
  return Boolean(agent && agent.role === 'applier' && agent.deliveries?.length && agent.assignments?.some(assignment => assignment.block === block.id && contribution.scope.every(scope => scopeCoveredBy(assignment.scope, scope))));
}

function completeWriters(block: BlockState): boolean {
  const authors = new Set([...(block.unattributedWriters ?? []), ...(block.contributions ?? []).map(contribution => contribution.actor)]);
  return new Set(block.unattributedWriters ?? []).size === (block.unattributedWriters?.length ?? 0) && new Set(block.writers).size === block.writers.length && block.writers.length === authors.size && block.writers.every(writer => authors.has(writer));
}

function agentAssignments(run: Run, agent: AgentRecord): boolean {
  const metadata = agent.requestedConfiguration !== undefined || agent.observedConfiguration !== undefined || agent.observations !== undefined || agent.replacementFor !== undefined;
  if (!metadata) return agent.assignments === undefined || Array.isArray(agent.assignments);
  if (!Array.isArray(agent.assignments) || !agent.assignments.length) return false;
  if (agent.requestedConfiguration && !agent.assignments.some(assignment => assignment.requestedConfiguration && sameConfiguration(assignment.requestedConfiguration, agent.requestedConfiguration))) return false;
  if (agent.observedConfiguration && (!agent.observations?.length || !sameConfiguration(agent.observations.at(-1)!.configuration, agent.observedConfiguration))) return false;
  if (agent.replacementFor) {
    const predecessor = run.agents.find(candidate => candidate.id === agent.replacementFor);
    if (!predecessor || predecessor.role !== agent.role || predecessor.status !== 'finished') return false;
  }
  const latest = agent.assignments.at(-1)!;
  if (agent.block !== latest.block || JSON.stringify(agent.scope) !== JSON.stringify(latest.scope)) return false;
  return agent.assignments.every(assignment => {
    if (!timestamp(assignment?.at) || !texts(assignment?.scope)) return false;
    if (assignment.requestedConfiguration !== undefined && !nativeConfiguration(assignment.requestedConfiguration)) return false;
    if (assignment.observedConfiguration !== undefined && !modelConfiguration(assignment.observedConfiguration)) return false;
    if (assignment.replacementFor !== undefined && assignment.replacementFor !== agent.replacementFor) return false;
    if (assignment.block === 'final') return agent.role === 'reviewer';
    return run.blocks.some(block => block.id === assignment.block && assignment.scope.every(scope => scopeCoveredBy(blockScope(run, block), scope)));
  });
}

function blockScope(run: Run, block: BlockState): string[] {
  return run.spec.blocks.find(specification => specification.id === block.id)?.scope ?? [];
}

function scopeCoveredBy(assigned: string[], requested: string): boolean {
  return assigned.some(scope => scope === requested || scope === '.' || scope === '**' || scopeMatches(requested, [scope]));
}

function assertExternalFulfillments(run: Run): void {
  for (const block of run.blocks) {
    if (block.externalFulfillment === undefined && block.externalFulfillments === undefined) continue;
    if (run.version < 4 || !Array.isArray(block.externalFulfillments) || !block.externalFulfillments.length) throw new Error('External fulfillment requires version 4 and retained provenance history; no migration was applied');
    for (const fulfillment of block.externalFulfillments) {
      if (!fulfillment || !text(fulfillment.sourceProject) || !path.isAbsolute(fulfillment.sourceProject) || !identifier(fulfillment.sourceRun) || !digest(fulfillment.sourceSpecDigest) || !digest(fulfillment.targetSpecDigest) || !digest(fulfillment.contributionDigest) || !digest(fulfillment.sourceEvidenceDigest) || !texts(fulfillment.sourceBlocks) || !fulfillment.sourceBlocks.every(identifier) || new Set(fulfillment.sourceBlocks).size !== fulfillment.sourceBlocks.length || !text(fulfillment.evidence) || !timestamp(fulfillment.at) || !block.reviews.some(review => review.id === fulfillment.acceptanceReviewId && review.verdict === 'pass')) throw new Error('External fulfillment provenance is malformed; no migration was applied');
    }
    if (block.externalFulfillment !== undefined && (block.status !== 'closed' || !block.externalFulfillments.some(entry => JSON.stringify(entry) === JSON.stringify(block.externalFulfillment)))) throw new Error('Active external fulfillment must match a closed checkpoint and its retained history; no migration was applied');
  }
}

function identifier(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function text(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function texts(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(text); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function modelConfiguration(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const configuration = value as Record<string, unknown>;
  return Object.keys(configuration).every(key => key === 'model' || key === 'reasoningEffort' || key === 'forkTurns') && text(configuration.model) && text(configuration.reasoningEffort) && (configuration.forkTurns === undefined || configuration.forkTurns === 'none');
}
function nativeConfiguration(value: unknown): boolean { return modelConfiguration(value) && (value as { forkTurns?: unknown }).forkTurns === 'none'; }
function validComparableProgress(value: { beforeAttempt?: unknown; afterAttempt?: unknown; metric?: unknown; before?: unknown; after?: unknown; evidence?: unknown }): boolean {
  return text(value.beforeAttempt) && text(value.afterAttempt) && text(value.metric) && typeof value.before === 'number' && Number.isFinite(value.before) && typeof value.after === 'number' && Number.isFinite(value.after) && texts(value.evidence);
}
