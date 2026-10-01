import { existsSync, readFileSync } from 'node:fs';
import { activeBlock, event, promoteRecoveryRecord } from './lifecycle.ts';
import { digest } from './project.ts';
import { recoveryBudget } from './recovery-policy.ts';
import { tierRank } from './model-policy.ts';
import type { BlockState, RecoveryBudget, RecoveryControl, RecoveryProgress, RecoveryProgressInput, RecoveryStatus, RecoveryStrategy, Run } from './types.ts';

interface RecoveryStrategyInput {
  block: string;
  failureKey: string;
  diagnosis: { agent: string; report: string; evidence: string[] };
  approach: string;
  progress?: { beforeAttempt: string; afterAttempt: string; metric: string; before: number; after: number; evidence: string[] };
}

export function recoveryStatus(run: Run): RecoveryStatus {
  const budget = recoveryBudget(run);
  const block = run.blocks.find(entry => entry.id === run.activeBlock);
  const failureKey = block?.failure ? currentFailureKey(block) : undefined;
  const pause = block?.failure ? recoveryPause(run, block, budget, failureKey!) : undefined;
  const active = run.status === 'running' || run.status === 'blocked';
  const canCorrect = active && block ? !block.failure || !pause || pause.kind === 'native-access' : false;
  const canVerify = active && Boolean(block) && !block?.failure;
  return { ...budget, run: run.spec.id, ...(block ? { block: block.id } : {}), ...(failureKey ? { failureKey } : {}), ...(pause ? { pause } : {}), canCorrect, canVerify };
}

export function recordRecoveryStrategy(run: Run, value: unknown): void {
  const { block } = activeBlock(run);
  if (!block.failure) throw new Error('Recovery strategy needs an unresolved failure');
  const input = strategyInput(value);
  const failureKey = currentFailureKey(block);
  if (input.block !== block.id || input.failureKey !== failureKey) throw new Error('Recovery strategy must bind the active unresolved failure and its current round');
  const control = run.recoveryControl ?? { strategies: [], progress: [] };
  const diagnosis = validateDiagnosis(run, block, input, control);
  validateComparableProgress(run, block, input.progress);
  if (control.strategies.some(strategy => strategy.failureKey === failureKey && strategy.round === block.rounds.length)) throw new Error('This failure already has a recovery strategy; record actual progress or a new failure before reevaluating it');
  promoteRecoveryRecord(run, recoveryBudget(run).policy ? 4 : 3);
  run.recoveryControl = control;
  control.strategies.push({ ...input, diagnosis, round: block.rounds.length, at: new Date().toISOString() });
  event(run, 'recovery-strategy', `${block.id}:${block.rounds.length}`);
}

export function recordRecoveryProgress(run: Run, progress: RecoveryProgressInput): void {
  const auto = Boolean(recoveryBudget(run).policy);
  if (!auto && !run.recovery && !run.recoveryControl) return;
  const { block } = activeBlock(run);
  const control = run.recoveryControl ?? { strategies: [], progress: [] };
  let observation: RecoveryProgress;
  const at = new Date().toISOString();
  if (progress.kind === 'check') {
    validateCheckProgress(run, block, progress.attempt);
    if (auto && !newCheckProgress(run, block, control, progress.attempt)) return;
    observation = { ...progress, block: block.id, round: block.rounds.length, at };
  } else {
    const finding = validateFindingProgress(block, progress.id);
    if (auto && control.progress.some(entry => entry.block === block.id && entry.kind === 'finding' && entry.id === progress.id)) return;
    observation = { ...progress, evidence: finding.evidence, resolution: finding.resolution!, block: block.id, round: block.rounds.length, at };
  }
  const recorded = control.progress.some(entry => entry.block === observation.block && (entry.kind === 'check' && observation.kind === 'check'
    ? entry.attempt === observation.attempt
    : entry.kind === 'finding' && observation.kind === 'finding' && entry.id === observation.id && entry.evidence === observation.evidence && entry.resolution === observation.resolution));
  if (recorded) return;
  promoteRecoveryRecord(run, auto ? 4 : 3);
  run.recoveryControl = control;
  control.progress.push(observation);
  event(run, 'recovery-progress', progress.kind === 'check' ? progress.attempt : progress.id);
}

export function revokeFindingProgress(run: Run, id: string): void {
  if (!run.recoveryControl || !recoveryBudget(run).policy) return;
  const { block } = activeBlock(run);
  for (const progress of run.recoveryControl.progress) {
    if (progress.kind === 'finding' && progress.block === block.id && progress.id === id && !progress.revokedAt) progress.revokedAt = new Date().toISOString();
  }
  promoteRecoveryRecord(run, 4);
}

function recoveryPause(run: Run, block: BlockState, budget: RecoveryBudget, failureKey: string) {
  if (block.failure!.kind === 'decision' && (!block.failure!.approvalDigest || block.failure!.approvalDigest === digest(JSON.stringify(run.approval)))) return { kind: 'decision' as const, reason: 'Material decision still requires actual user authorization of its amendment.', next: 'Record the approved amendment before correcting this decision failure.' };
  if (budget.limit !== undefined && budget.used >= budget.limit || !budget.policy && budget.limit === undefined && block.rounds.length >= 3) return { kind: 'budget' as const, reason: 'Recovery budget exhausted by the recorded correction limit.', next: budget.policy ? 'Use recovery adopt with actual user authorization to change the explicit ceiling.' : 'Use applicable policy-adoption authority or an explicit finite recovery authorization before another correction.' };
  if (strategyRequired(run, block, run.recoveryControl, failureKey)) return { kind: 'stagnation' as const, reason: 'Recovery needs a fresh delivered diagnosis and a concrete repair strategy.', next: 'Record a strategy bound to this failure before retrying.' };
  if (nativeAccess(run, block)) return { kind: 'native-access' as const, reason: 'The failed check is waiting for its linked native permission recovery.', next: 'Record native authorization evidence for the linked permission episode, then retry that check.' };
  return undefined;
}

function strategyRequired(run: Run, block: BlockState, control: RecoveryControl | undefined, failureKey: string): boolean {
  if (block.rounds.length < 2) return false;
  if (control) assertControlEvidence(run, block, control);
  const current = control?.strategies.some(strategy => strategy.failureKey === failureKey && strategy.round === block.rounds.length) ?? false;
  const auto = Boolean(recoveryBudget(run).policy);
  if (!auto && block.rounds.length === 2) return !current;
  const credited = auto ? qualifiedProgressRound(run, block, control) : Math.max(...(control?.progress ?? []).filter(entry => entry.block === block.id).map(entry => entry.round), 0);
  const diagnosed = Math.max(...(control?.strategies ?? []).filter(strategy => strategy.block === block.id).map(strategy => strategy.round), 0);
  return block.rounds.length - Math.max(credited, diagnosed) >= 2 && !current;
}

function nativeAccess(run: Run, block: BlockState): boolean {
  const failed = run.checks.find(check => check.attempt === block.failure?.checkAttempt);
  const episode = failed && block.permissionEpisodes?.[failed.id];
  return block.failure?.kind === 'infrastructure' && failed?.status === 'blocked' && failed.blocker === 'permission' && Boolean(episode && failed.permissionEpisode === episode.id);
}

function validateDiagnosis(run: Run, block: BlockState, input: RecoveryStrategyInput, control: RecoveryControl): RecoveryStrategy['diagnosis'] {
  if (input.diagnosis.agent === run.spec.principal) {
    const repeated = control.strategies.some(strategy => strategy.diagnosis.agent === input.diagnosis.agent && strategy.diagnosis.report === input.diagnosis.report && strategy.approach === input.approach);
    const progressed = recoveryBudget(run).policy
      ? qualifiedProgressRound(run, block, control) > 0 && qualifiedProgressRound(run, block, control) >= block.rounds.length - 1
      : control.progress.some(progress => progress.block === block.id && progress.round >= block.rounds.length - 1);
    if (repeated && !progressed) throw new Error('Recovery strategy needs a changed principal diagnosis or approach, or actual recorded progress');
    return input.diagnosis;
  }
  const agent = run.agents.find(entry => entry.id === input.diagnosis.agent);
  const delivery = agent?.deliveries?.at(-1);
  if (!agent || agent.block !== block.id || agent.status !== 'finished' || !delivery) throw new Error('Recovery strategy needs the actual delivered result from its registered native diagnosis agent');
  if (!block.contributions && (!agent.tier || tierRank(agent.tier) < tierRank(block.implementationTier ?? 'luna'))) throw new Error('Recovery strategy diagnosis agent tier does not cover the active implementation tier');
  if (control.strategies.some(strategy => strategy.diagnosis.agent === agent.id && strategy.diagnosis.delivery?.at === delivery.at)) throw new Error('Recovery strategy needs a fresh native delivery; an old result cannot be relabeled as a new diagnosis');
  return { ...input.diagnosis, delivery: { ...delivery } };
}

function validateComparableProgress(run: Run, block: BlockState, progress: RecoveryStrategyInput['progress']): void {
  if (!progress) return;
  const after = assertMetricLogs(run, block, progress);
  if (!recoveryBudget(run).policy) return;
  if (!run.spec.blocks.find(entry => entry.id === block.id)?.checks.includes(after.id)) throw new Error('Comparable AUTO progress needs a required check');
  const implicated = run.checks.find(entry => entry.attempt === block.failure?.checkAttempt);
  if (!implicated || implicated.id !== after.id) throw new Error('Comparable AUTO progress must address the check implicated by the current failure');
  const prior = (run.recoveryControl?.strategies ?? []).filter(entry => entry.block === block.id && entry.progress && run.checks.find(check => check.attempt === entry.progress!.afterAttempt)?.id === after.id);
  if (prior.some(entry => entry.progress!.afterAttempt === progress.afterAttempt && entry.progress !== progress)) throw new Error('A measured check attempt cannot be credited again');
  if (prior.some(entry => entry.progress!.metric !== progress.metric)) throw new Error('Comparable AUTO progress must preserve the established check metric');
}

function newCheckProgress(run: Run, block: BlockState, control: RecoveryControl, attempt: string): boolean {
  const check = run.checks.find(entry => entry.attempt === attempt)!;
  const failed = previousFailure(run, block, attempt);
  if (!run.spec.blocks.find(entry => entry.id === block.id)?.checks.includes(check.id) || !failed || !checkLogIntact(failed)) return false;
  return !firstCheckCredit(run, block, control, check.id);
}

function previousFailure(run: Run, block: BlockState, attempt: string) {
  const current = run.checks.findIndex(entry => entry.attempt === attempt);
  const check = run.checks[current];
  return check && run.checks.slice(0, current).findLast(entry => entry.block === block.id && entry.id === check.id && (entry.status === 'fail' || entry.status === 'reproduced') && entry.finished && check.finished && Date.parse(entry.finished) < Date.parse(check.finished) && JSON.stringify(entry.command) === JSON.stringify(check.command));
}

function firstCheckCredit(run: Run, block: BlockState, control: RecoveryControl, id: string) {
  return control.progress.find(entry => entry.kind === 'check' && entry.block === block.id && run.checks.find(check => check.attempt === entry.attempt)?.id === id && previousFailure(run, block, entry.attempt));
}

function validateCheckProgress(run: Run, block: BlockState, attempt: string): void {
  const check = run.checks.find(entry => entry.attempt === attempt);
  if (!check || check.block !== block.id || check.status !== 'pass' || !checkLogIntact(check)) throw new Error('Recovery check progress needs an intact recorded passing check in the active block');
}

function validateFindingProgress(block: BlockState, id: string) {
  const finding = block.findings.find(entry => entry.id === id);
  if (!finding || finding.disposition === 'open' || !finding.resolution?.trim()) throw new Error('Recovery finding progress needs an existing resolved finding with evidence');
  return finding;
}

function strategyInput(value: unknown): RecoveryStrategyInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Recovery strategy must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['block', 'failureKey', 'diagnosis', 'approach', 'progress'].includes(key))) throw new Error('Recovery strategy contains unsupported fields');
  const diagnosis = input.diagnosis;
  if (!text(input.block) || !hash(input.failureKey) || !text(input.approach) || !diagnosis || typeof diagnosis !== 'object' || Array.isArray(diagnosis)) throw new Error('Recovery strategy is malformed');
  const details = diagnosis as Record<string, unknown>;
  if (Object.keys(details).some(key => !['agent', 'report', 'evidence'].includes(key)) || !text(details.agent) || !text(details.report) || !texts(details.evidence)) throw new Error('Recovery strategy diagnosis needs an agent, delivered outcome and concrete evidence');
  const progress = comparableProgress(input.progress);
  return { block: input.block, failureKey: input.failureKey, diagnosis: { agent: details.agent, report: details.report, evidence: details.evidence }, approach: input.approach, ...(progress ? { progress } : {}) };
}

function comparableProgress(value: unknown): RecoveryStrategyInput['progress'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Comparable recovery progress must be an object');
  const progress = value as Record<string, unknown>;
  if (Object.keys(progress).some(key => !['beforeAttempt', 'afterAttempt', 'metric', 'before', 'after', 'evidence'].includes(key)) || !text(progress.beforeAttempt) || !text(progress.afterAttempt) || !text(progress.metric) || !finite(progress.before) || !finite(progress.after) || !texts(progress.evidence)) throw new Error('Comparable recovery progress is malformed');
  return { beforeAttempt: progress.beforeAttempt, afterAttempt: progress.afterAttempt, metric: progress.metric, before: progress.before, after: progress.after, evidence: progress.evidence };
}

function assertControlEvidence(run: Run, block: BlockState, control: RecoveryControl): void {
  for (const strategy of control.strategies.filter(entry => entry.block === block.id)) {
    if (strategy.diagnosis.delivery) {
      const agent = run.agents.find(entry => entry.id === strategy.diagnosis.agent);
      if (!agent?.deliveries?.some(delivery => delivery.at === strategy.diagnosis.delivery!.at && delivery.report === strategy.diagnosis.delivery!.report)) throw new Error('Recorded recovery strategy delivery is no longer intact');
    }
    if (strategy.progress) {
      const check = assertMetricLogs(run, block, strategy.progress);
      if (recoveryBudget(run).policy && !run.spec.blocks.find(entry => entry.id === block.id)?.checks.includes(check.id)) throw new Error('Recorded AUTO metric progress needs a required check');
    }
  }
  for (const progress of control.progress.filter(entry => entry.block === block.id)) {
    if (progress.kind === 'check') validateCheckProgress(run, block, progress.attempt);
  }
}

function qualifiedProgressRound(run: Run, block: BlockState, control: RecoveryControl | undefined): number {
  if (!control) return 0;
  const recorded = control.progress.filter(progress => progress.block === block.id && !progress.revokedAt && (progress.kind === 'check'
    ? currentCheckCredit(run, block, control, progress)
    : control.progress.find(entry => entry.block === block.id && entry.kind === 'finding' && entry.id === progress.id) === progress && block.findings.some(finding => finding.id === progress.id && finding.disposition !== 'open' && finding.evidence === progress.evidence && finding.resolution === progress.resolution))).map(progress => progress.round);
  const comparable = control.strategies.filter(strategy => strategy.block === block.id && strategy.progress).filter(strategy => currentMetricBest(run, control, strategy)).map(strategy => strategy.round);
  return Math.max(...recorded, ...comparable, 0);
}

function currentCheckCredit(run: Run, block: BlockState, control: RecoveryControl, progress: Extract<RecoveryProgress, { kind: 'check' }>): boolean {
  const position = run.checks.findIndex(check => check.attempt === progress.attempt);
  const check = run.checks[position]!;
  const failed = previousFailure(run, block, progress.attempt);
  if (!run.spec.blocks.find(entry => entry.id === block.id)?.checks.includes(check.id) || !failed || !checkLogIntact(failed)) return false;
  if (firstCheckCredit(run, block, control, check.id) !== progress) return false;
  return !run.checks.slice(position + 1).some(entry => entry.block === block.id && entry.id === check.id && entry.status !== 'pass');
}

function currentMetricBest(run: Run, control: RecoveryControl, candidate: RecoveryStrategy): boolean {
  const check = run.checks.find(entry => entry.attempt === candidate.progress!.afterAttempt)!;
  const latestCheck = run.checks.findLast(entry => entry.block === candidate.block && entry.id === check.id);
  if (latestCheck !== check) return false;
  const metrics = control.strategies.filter(strategy => strategy.block === candidate.block && strategy.progress && run.checks.find(entry => entry.attempt === strategy.progress!.afterAttempt)?.id === check.id);
  if (metrics.some(strategy => strategy.progress!.metric !== candidate.progress!.metric)) return false;
  if (metrics.at(-1) !== candidate) return false;
  return metrics.slice(0, -1).every(strategy => Math.min(strategy.progress!.before, strategy.progress!.after) > candidate.progress!.after);
}

function assertMetricLogs(run: Run, block: BlockState, progress: NonNullable<RecoveryStrategy['progress']>) {
  if (!finite(progress.before) || !finite(progress.after) || progress.before < 0 || progress.after < 0 || progress.before <= progress.after) throw new Error('Comparable recovery progress needs a nonnegative reduction from before to after');
  const beforePosition = run.checks.findIndex(check => check.attempt === progress.beforeAttempt);
  const afterPosition = run.checks.findIndex(check => check.attempt === progress.afterAttempt);
  const before = run.checks[beforePosition];
  const after = run.checks[afterPosition];
  if (!before || !after || beforePosition >= afterPosition || before.block !== block.id || after.block !== block.id || before.id !== after.id || JSON.stringify(before.command) !== JSON.stringify(after.command) || before.status === 'running' || after.status === 'running' || !before.finished || !after.finished || !(Date.parse(before.finished) < Date.parse(after.finished)) || !checkLogIntact(before) || !checkLogIntact(after)) throw new Error('Comparable recovery progress needs intact chronological before and after logs from the same completed check');
  return after;
}

function checkLogIntact(check: { log: string; logDigest?: string }): boolean { return Boolean(check.logDigest) && existsSync(check.log) && digest(readFileSync(check.log)) === check.logDigest; }
function currentFailureKey(block: BlockState): string { return digest(JSON.stringify([block.id, block.failure, block.rounds.length])); }
function text(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
function texts(value: unknown): value is string[] { return Array.isArray(value) && value.length > 0 && value.every(text); }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
