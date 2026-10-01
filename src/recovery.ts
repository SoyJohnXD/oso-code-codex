import { readFileSync } from 'node:fs';
import { digest, snapshot } from './project.ts';
import { activeBlock, event, promoteRecoveryRecord } from './lifecycle.ts';
import { recoveryStatus } from './recovery-control.ts';
import { processAlive, releaseStoppedCheckLocks, requireStoppedIdentity } from './store.ts';
import type { CheckRecovery, FailureKind, Run } from './types.ts';
import { namedResourceLockDirectory } from './isolated.ts';

export function recordFailure(run: Run, kind: FailureKind, cause: string, checkAttempt?: string): void {
  const { block, specification } = activeBlock(run);
  block.failure = { kind, cause, signature: digest(JSON.stringify(snapshot(run.project, specification.scope))), approvalDigest: digest(JSON.stringify(run.approval)) };
  if (checkAttempt) block.failure.checkAttempt = checkAttempt;
  run.next = `${kind}: ${cause}. Repair the cause and use retry with evidence; do not replace the run or reviewer.`;
  event(run, 'failure', `${kind}: ${cause}`);
}

export function recoverCheck(run: Run, id: string, recovery: CheckRecovery): void {
  const { block } = activeBlock(run);
  const failure = block.failure;
  if (!failure) throw new Error('No unresolved failure; continue without spending another round');
  const failedCheck = run.checks.find(check => check.attempt === failure.checkAttempt);
  if (failedCheck && (failedCheck.id !== id || failedCheck.block !== block.id)) throw new Error('Recovery must target the failed check in the active block');
  if (recovery.kind === 'correction') {
    retry(run, recovery.evidence, recovery.escalated ?? false, recovery.measured);
    if (block.failure || block.status === 'blocked') throw new Error(run.next);
    return;
  }
  const episode = block.permissionEpisodes?.[id];
  if (failure.kind !== 'infrastructure' || failedCheck?.status !== 'blocked' || failedCheck.blocker !== 'permission' || !episode || failedCheck.permissionEpisode !== episode.id) {
    throw new Error('Permission recovery requires the linked observed permission failure; other and legacy failures use ordinary correction');
  }
  if (!recovery.evidence.trim()) throw new Error('Permission recovery needs evidence of actual native authorization for this invocation');
  if (episode.recovery) throw new Error('Permission recovery already attempted for this unresolved episode; preserve the blocker and diagnose the actual cause');
  if (!failedCheck.logDigest || digest(readFileSync(failedCheck.log)) !== failedCheck.logDigest) throw new Error('Permission recovery needs the intact recorded failure log');
  episode.recovery = { evidence: recovery.evidence, at: new Date().toISOString() };
  delete block.failure;
  block.status = 'active';
  run.status = 'running';
  run.next = `Confirm the native-authorized permission recovery for check ${id}`;
  event(run, 'permission-retry', `${episode.id}: ${recovery.evidence}`);
}

export function retry(run: Run, evidence: string, escalated: boolean, changedEnvironment?: string): void {
  const { block, specification } = activeBlock(run);
  const failure = block.failure;
  if (!failure) throw new Error('No unresolved failure; continue without spending another round');
  if (!evidence.trim()) throw new Error('Recovery needs concrete evidence of what changed');
  const status = recoveryStatus(run);
  if (!status.canCorrect) throw new Error(status.pause?.reason ?? 'Recovery cannot correct the current run state');
  const current = digest(JSON.stringify(snapshot(run.project, specification.scope)));
  const externalRepair = (failure.kind === 'infrastructure' || failure.kind === 'delivery') && changedEnvironment?.trim();
  const approvalDigest = digest(JSON.stringify(run.approval));
  const authorizedDecision = failure.kind === 'decision' && Boolean(failure.approvalDigest) && failure.approvalDigest !== approvalDigest;
  if (current === failure.signature && !externalRepair && !authorizedDecision) throw new Error('Cause is unchanged; provide measured environment/delivery evidence or repair relevant inputs before retrying');
  const signature = digest(JSON.stringify([current, failure.kind, failure.cause, changedEnvironment ?? '', failure.kind === 'decision' ? approvalDigest : null]));
  if (block.rounds.some(round => round.signature === signature)) throw new Error('This unchanged recovery was already attempted; no relaunch');
  if (status.limit !== undefined && !run.recovery && run.spec.id === status.owner) {
    promoteRecoveryRecord(run, 3);
    run.recovery = { owner: status.owner, specDigest: status.specDigest, initialLimit: status.limit, grants: [] };
  }
  block.rounds.push({ kind: failure.kind, cause: failure.cause, evidence, escalated, signature, at: new Date().toISOString() });
  delete block.failure;
  block.status = 'active';
  run.status = 'running';
  run.next = `Confirm the repaired cause for ${block.id} with affected checks and the existing reviewer`;
  const correctionCount = status.limit !== undefined ? `${status.used + 1}/${status.limit}` : status.policy ? `${status.used + 1} (auto)` : `${block.rounds.length}/3`;
  event(run, 'retry', `${correctionCount}: ${evidence}`);
}

export function reconcile(run: Run): void {
  for (const check of run.checks.filter(entry => entry.status === 'running')) {
    if (processAlive(check.runner)) continue;
    if (check.child && processAlive(check.child)) {
      run.next = `Check ${check.attempt} still owns pid ${check.child.pid}; do not replace it`;
      continue;
    }
    check.status = 'interrupted';
    check.finished = new Date().toISOString();
    check.diagnostics.push('Runner ended without a final result; existing logs were retained');
    if (run.activeBlock) recordFailure(run, 'infrastructure', `Interrupted check ${check.id}`);
  }
  const unresolved = run.agents.filter(agent => agent.status !== 'finished');
  if (unresolved.length) run.next = `Reconcile native agent handles before replacing writers: ${unresolved.map(agent => agent.id).join(', ')}`;
  event(run, 'resume', run.next);
}

export function confirmStoppedCheck(run: Run, attempt: string, evidence: string): void {
  if (!evidence.trim()) throw new Error('Provide the actual native terminal result confirming the runner and its children ended');
  const check = run.checks.find(entry => entry.attempt === attempt);
  if (!check || check.status !== 'running') throw new Error('Select the recorded running check; completed checks need no recovery');
  requireStoppedIdentity(check.runner);
  if (check.child) requireStoppedIdentity(check.child);
  releaseStoppedCheckLocks(run.project, check.runner, namedResourceLockDirectory(run));
  check.status = 'interrupted';
  check.finished = new Date().toISOString();
  check.diagnostics.push(`Native handle confirmed stopped without a final result: ${evidence}`);
  recordFailure(run, 'infrastructure', `Interrupted check ${check.id}; ${evidence}`);
  event(run, 'native-stop-confirmed', `${attempt}: ${evidence}`);
}
