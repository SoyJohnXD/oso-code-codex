import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { activeBlock, event } from './lifecycle.ts';
import { checkFingerprint, digest, insideProject } from './project.ts';
import { recordFailure, reconcile, recoverCheck } from './recovery.ts';
import { acquireLock, processIdentity, readRun, stateDirectory, transaction, writeRun } from './store.ts';
import type { CheckRecovery, CheckResult, CheckSpec, Run } from './types.ts';
import type { LookupCache } from './environment.ts';
import { namedResourceLockDirectory } from './isolated.ts';
import { recordRecoveryProgress, recoveryStatus } from './recovery-control.ts';
import { childSatisfiesRoadmap, roadmapParentId } from './roadmap-lineage.ts';

export async function executeCheck(project: string, id: string, reproduction = false, recovery?: CheckRecovery): Promise<CheckResult & { reused?: boolean }> {
  if (reproduction && recovery) throw new Error('Recovery cannot be combined with red reproduction');
  const prepared = transaction(project, () => prepareCheck(readRun(project), id, reproduction, recovery));
  if ('reused' in prepared) return prepared;
  const { run, specification, result, release, log } = prepared;
  try {
    const outcome = await runCommand(run, specification, result, log);
    return transaction(project, () => finishCheck(readRun(project, run.spec.id), specification, result.attempt, { ...outcome, reproduction }));
  } finally { closeSync(log); release(); }
}

export function validCheck(run: Run, id: string, cache: LookupCache = new Map()): CheckResult | undefined {
  if (run.blocks.some(block => block.permissionEpisodes?.[id])) return undefined;
  const specification = run.spec.checks.find(check => check.id === id);
  if (!specification) return undefined;
  const fingerprint = checkFingerprint(run.project, specification, cache);
  return relatedRuns(run).flatMap(related => related.checks).findLast(check => check.id === id && check.status === 'pass' && check.fingerprint === fingerprint && check.logDigest && intactLog(check));
}

export function relatedRuns(run: Run): Run[] {
  const parentId = roadmapParentId(run);
  const parent = run.spec.mode === 'roadmap' ? run : parentId ? readRun(run.project, parentId) : run;
  if (!parent.approval || parent.spec.mode !== 'roadmap') return [run];
  const member = parent.spec.children?.find(child => child.id === run.spec.id);
  if (run !== parent && (!member || !childSatisfiesRoadmap(parent, member, run))) return [run];
  const related = [parent];
  for (const child of parent.spec.children ?? []) {
    const directory = stateDirectory(run.project);
    if (!existsSync(path.join(directory, 'runs', `${child.id}.json`)) && !existsSync(path.join(directory, `${child.id}.json`))) continue;
    const candidate = child.id === run.spec.id ? run : readRun(run.project, child.id);
    if (childSatisfiesRoadmap(parent, child, candidate)) related.push(candidate);
  }
  return related;
}

function prepareCheck(run: Run, id: string, reproduction: boolean, recovery?: CheckRecovery): { run: Run; specification: CheckSpec; result: CheckResult; release: () => void; log: number } | (CheckResult & { reused: true }) {
  reconcile(run);
  const { block, specification: blockSpec } = activeBlock(run);
  if (!blockSpec.checks.includes(id)) throw new Error(`Check ${id} is outside the active block's approved verification bar`);
  const availability = recoveryStatus(run);
  if (!recovery && !availability.canVerify) { writeRun(run); throw new Error(availability.pause?.next ?? run.next); }
  if (run.checks.some(check => check.status === 'running')) throw new Error('A check executor is still running; reconcile its process before starting another');
  if (reproduction && run.checks.some(check => check.block === block.id && check.id === id)) throw new Error('A red reproduction is only the first observation of this block/check; retain prior evidence and use ordinary correction for later failures');
  const specification = run.spec.checks.find(check => check.id === id)!;
  const cache: LookupCache = new Map();
  const previous = validCheck(run, id, cache);
  if (reproduction && previous) throw new Error('Current evidence already passes; inspect the intended reproduction instead of inventing a red result');
  if (previous) {
    if (recovery) recoverCheck(run, id, recovery);
    if (block.permissionEpisodes) delete block.permissionEpisodes[id];
    event(run, 'check-reused', previous.attempt);
    writeRun(run);
    return { ...previous, reused: true };
  }
  const releases: (() => void)[] = [];
  let log: number | undefined;
  let logPath: string | undefined;
  try {
    releases.push(acquireLock(path.join(stateDirectory(run.project), 'locks', digest('project-bar'))));
    const shared = namedResourceLockDirectory(run);
    for (const resource of [...new Set(specification.resources ?? [])].sort()) releases.push(acquireLock(path.join(shared ?? path.join(stateDirectory(run.project), 'locks'), digest(resource))));
    const attempt = `${id}-${randomUUID()}`;
    const logs = path.join(stateDirectory(run.project), 'logs', run.spec.id);
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    const result: CheckResult = {
      id, attempt, block: block.id, command: specification.command, cwd: insideProject(run.project, specification.cwd ?? '.'),
      fingerprint: checkFingerprint(run.project, specification, cache), started: new Date().toISOString(), status: 'running',
      log: path.join(logs, `${attempt}.log`), diagnostics: [], runner: processIdentity(process.pid),
    };
    log = openSync(result.log, 'wx', 0o600);
    logPath = result.log;
    if (recovery) recoverCheck(run, id, recovery);
    if (block.permissionEpisodes?.[id]) result.permissionEpisode = block.permissionEpisodes[id]!.id;
    run.checks.push(result);
    event(run, 'check-start', attempt);
    writeRun(run);
    return { run, specification, result, log, release: () => releases.reverse().forEach(unlock => unlock()) };
  } catch (error) {
    if (log !== undefined) closeSync(log);
    if (logPath) unlinkSync(logPath);
    releases.reverse().forEach(unlock => unlock());
    throw error;
  }
}

async function runCommand(run: Run, specification: CheckSpec, result: CheckResult, log: number): Promise<{ code: number | null; signal: string | null; error?: string; timeout: boolean }> {
  return new Promise(resolve => {
    const child = spawn(specification.command[0]!, specification.command.slice(1), { cwd: result.cwd, stdio: ['ignore', log, log], detached: process.platform !== 'win32' });
    let timeout = false;
    let error: string | undefined;
    if (child.pid) transaction(run.project, () => {
      const current = readRun(run.project, run.spec.id);
      current.checks.find(check => check.attempt === result.attempt)!.child = processIdentity(child.pid!);
      writeRun(current);
    });
    const deadline = setTimeout(() => {
      timeout = true;
      if (!child.pid) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') error = `Could not stop timed-out process: ${String(failure)}`;
      }
    }, specification.timeoutMs ?? 600_000);
    child.once('error', failure => { error = String(failure); });
    child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ code, signal, error, timeout }); });
  });
}

function finishCheck(run: Run, specification: CheckSpec, attempt: string, outcome: { code: number | null; signal: string | null; error?: string; timeout: boolean; reproduction: boolean }): CheckResult {
  const result = run.checks.find(check => check.attempt === attempt)!;
  const log = readFileSync(result.log);
  const classification = classifyOutput(log.toString('utf8'), outcome);
  result.finished = new Date().toISOString();
  result.exitCode = outcome.code;
  result.signal = outcome.signal;
  result.logDigest = digest(log);
  result.status = classification.status;
  result.diagnostics = classification.diagnostics;
  if (classification.blocker) result.blocker = classification.blocker;
  const missingReproduction = outcome.reproduction && classification.status === 'pass';
  if (missingReproduction) {
    result.status = 'blocked';
    result.diagnostics.push('Expected pre-implementation failure was not reproduced; inspect the reported behavior and regression coverage. No green evidence was recorded.');
  }
  if (outcome.reproduction && classification.status === 'fail' && outcome.code !== null && outcome.code !== 0) {
    result.status = 'reproduced';
    result.diagnostics.push('Expected pre-implementation failure observed; inspect the log to confirm the intended regression. This is not passing evidence.');
  }
  if (result.fingerprint !== checkFingerprint(run.project, specification)) {
    result.status = 'stale';
    result.diagnostics.push('Relevant inputs changed during this check');
  }
  const block = activeBlock(run).block;
  if (result.status === 'blocked' && result.blocker === 'permission') {
    const episodes = block.permissionEpisodes ??= {};
    const episode = episodes[specification.id] ??= { id: result.attempt };
    result.permissionEpisode = episode.id;
  }
  if (result.status === 'pass' && block.permissionEpisodes) delete block.permissionEpisodes[specification.id];
  if (result.status === 'pass') recordRecoveryProgress(run, { kind: 'check', attempt: result.attempt });
  if (result.status !== 'pass' && result.status !== 'reproduced') {
    recordFailure(run, missingReproduction || result.status === 'stale' ? 'delivery' : result.status === 'blocked' ? 'infrastructure' : 'product', `${specification.id}: ${result.diagnostics.join('; ') || `exit ${outcome.code}`}`, result.attempt);
    const episode = block.permissionEpisodes?.[specification.id];
    if (result.status === 'blocked' && result.blocker === 'permission') run.next = episode?.recovery
      ? `Permission recovery already attempted for check ${specification.id}; preserve the blocker and diagnose the actual cause. No automatic relaunch.`
      : `Check ${specification.id} encountered an access error. Inspect the cause; if native authorization resolves it, submit check ${specification.id} --retry-permission --evidence TEXT through the native approval route. Otherwise repair it using ordinary correction.`;
  }
  event(run, 'check-end', `${attempt}: ${result.status}`);
  writeRun(run);
  return result;
}

export function classifyOutput(log: string, outcome: { code: number | null; signal?: string | null; error?: string; timeout?: boolean }): { status: 'pass' | 'fail' | 'blocked'; diagnostics: string[]; blocker?: CheckResult['blocker'] } {
  const lines = log.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
  const warnings = lines.filter(line => /^\s*(?:(?:npm|pnpm|yarn)\s+WARN\b|(?:\[[^\]]+\]\s*)?WARN(?:ING)?\b|\(?node:\d+\)?.*\b\w*Warning:|(?:▲|⚠).*\bwarning\b|[1-9]\d*\s+warnings?\b)|:\d+(?::\d+)?\s+warning\b|^\s*\d+:\d+\s+warning\b/i.test(line));
  if (outcome.timeout) return { status: 'blocked', blocker: 'environment', diagnostics: [outcome.error ?? 'Command timed out; inspect the owned process and environment'] };
  const permissionError = (line: string): boolean =>
    (/^\s*(?:Error(?::|\s*\[)|(?:EACCES|EPERM|EROFS):)/i.test(line) && /\b(?:EACCES|EPERM|EROFS)\b/.test(line)) ||
    (/^\s*(?:(?:fatal|error):|(?:\/[^\s:]+\/)?(?:ba|da|z|k)?sh:)/i.test(line) && /:\s*(?:permission denied|read-only file system|operation not permitted|access is denied)\s*$/i.test(line));
  if (outcome.error) return { status: 'blocked', blocker: permissionError(outcome.error) ? 'permission' : 'environment', diagnostics: [outcome.error] };
  if (outcome.code !== 0) {
    const permission = lines.filter(permissionError);
    const infrastructure = lines.filter(line => /\b(?:ENOENT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b|^\s*(?:permission denied|command not found)|sandbox.*(?:denied|blocked)|network is unreachable/i.test(line));
    if (permission.length || infrastructure.length) return { status: 'blocked', blocker: permission.length ? 'permission' : 'environment', diagnostics: [...permission, ...infrastructure, ...warnings].slice(0, 30) };
    return { status: 'fail', diagnostics: warnings.slice(0, 30) };
  }
  return { status: warnings.length ? 'fail' : 'pass', diagnostics: warnings.slice(0, 30) };
}

function intactLog(check: CheckResult): boolean {
  try { return digest(readFileSync(check.log)) === check.logDigest; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
