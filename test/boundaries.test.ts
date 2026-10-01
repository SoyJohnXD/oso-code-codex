import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { blockBoundary, blockIntegrationBoundary, resolveBoundary, resolveCompletedIntegrationBoundary } from '../src/boundaries.ts';
import { executeCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { hookDecision } from '../src/hooks.ts';
import { event } from '../src/lifecycle.ts';
import { checkoutState } from '../src/parking.ts';
import { closeBlock, closeRun } from '../src/reviews.ts';
import { readRun, writeRun } from '../src/store.ts';
import type { ExternalContribution, Run } from '../src/types.ts';
import { approved, fixture, reviewed } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('a post-checkpoint delivery failure blocks repeated commit attempts and final closure', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  blockBoundary(run, 'commit', 'Native Git mount is read-only');
  writeRun(run);
  assert.equal(hookDecision({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: { command: 'git commit -m delivery' } }).allow, false);
  assert.throws(() => closeRun(run), /delivery action/);
  assert.throws(() => resolveBoundary(run, 'commit', 'Native Git mount is read-only', false), /new actual/);
  resolveBoundary(run, 'commit', 'Actual user approval explicitly removed commits from this synthetic task', false);
  closeRun(run);
  assert.equal(run.status, 'closed');
  assert.equal(run.checks.length, 1);
});

test('delivery correction budgets persist across changed causes and repeated boundaries', context => {
  const run = approved(fixture(context));
  for (let round = 0; round < 2; round++) {
    blockBoundary(run, 'commit', `Observed environment failure ${round}`);
    resolveBoundary(run, 'commit', `Native permission evidence ${round}`, false);
  }
  blockBoundary(run, 'commit', 'Changed label for commit failure');
  assert.throws(() => resolveBoundary(run, 'commit', 'Another ordinary retry', false), /budget/);
  resolveBoundary(run, 'commit', 'Justified final escalated native repair', true);
  blockBoundary(run, 'commit', 'Still unavailable');
  assert.throws(() => resolveBoundary(run, 'commit', 'Further escalation', true), /budget/);
  assert.equal(run.boundaries!.commit!.status, 'open');
});

test('an exhausted failed integration boundary can record a verified completed integration without another retry', context => {
  const project = fixture(context);
  const run = approved(project);
  const contribution = completedIntegration(project, 'vanished-isolated-run');
  exhaustDeliveryRounds(run);
  recordFailedIntegration(run, contribution.sourceRun, false, contribution);
  run.externalContributions = [contribution];
  run.isolatedSuccessors = [{ project: '/tmp/missing-isolated-peer', run: contribution.sourceRun, commonDirectory: '/tmp/missing-common-git', parkHead: contribution.before.head!, status: 'integrated' }];
  event(run, 'integration-finalized', contribution.sourceRun);
  writeRun(run);

  captureCommand([process.execPath, cli, 'boundary', '--action', 'commit', '--resolved', '--completed-integration', contribution.sourceRun, '--evidence', 'The durable Git interval and retained finalized integration record prove the merge already completed.'], project);
  const resolved = readRun(project);
  const boundary = resolved.boundaries!.commit!;
  assert.equal(boundary.status, 'resolved');
  assert.equal(boundary.rounds.length, 3);
  assert.deepEqual(boundary.completion?.commits, contribution.commits);
  assert.equal(boundary.completion?.sourceRun, contribution.sourceRun);
  assert.equal(resolved.events.filter(entry => entry.action === 'boundary-completed-integration').length, 1);
});

test('completed integration reconciliation is idempotent and leaves later work untouched', context => {
  const project = fixture(context);
  const run = approved(project);
  const contribution = completedIntegration(project, 'vanished-isolated-run');
  recordFailedIntegration(run, contribution.sourceRun, true);
  run.externalContributions = [contribution];
  event(run, 'integration-finalized', contribution.sourceRun);
  const linked = structuredClone(run);
  linked.spec = { ...linked.spec, id: 'linked-child' };
  linked.link = { parkedRun: run.spec.id, kind: 'parked-successor', createdAt: new Date().toISOString() };
  writeRun(linked);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 99;\n');
  resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'The retained immutable Git interval verifies the completed integration.');
  const receipt = structuredClone(run.boundaries!.commit!.completion!);
  const events = run.events.length;
  captureCommand(['git', 'add', 'app.mjs'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'later unrelated work'], project);
  resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'The retained immutable Git interval verifies the completed integration.');
  assert.deepEqual(run.boundaries!.commit!.completion, receipt);
  assert.equal(run.events.length, events);
  assert.equal(readFileSync(path.join(project, 'app.mjs'), 'utf8'), 'export const price = 99;\n');
  assert.equal(readRun(project, 'linked-child').boundaries!.commit!.completion?.sourceRun, contribution.sourceRun);
});

test('completed integration reconciliation accepts a recorded rename and ignores intervening non-integration metadata', context => {
  const project = fixture(context);
  const run = approved(project);
  const contribution = completedRenameIntegration(project, 'vanished-isolated-run');
  recordFailedIntegration(run, contribution.sourceRun, true);
  run.externalContributions = [contribution];
  event(run, 'integration-finalized', contribution.sourceRun);
  resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'The immutable no-renames Git diff and recorded interval prove this completed integration.');
  assert.equal(run.boundaries!.commit!.status, 'resolved');
  assert.deepEqual(run.boundaries!.commit!.completion?.commits, contribution.commits);
});

test('a prior completed contribution cannot clear a later superseding integration failure', context => {
  const project = fixture(context);
  const run = approved(project);
  const contribution = completedIntegration(project, 'earlier-isolated-run');
  recordFailedIntegration(run, contribution.sourceRun);
  resolveBoundary(run, 'commit', 'Native authorization allowed the first retained integration retry.', false);
  event(run, 'integration-intent', 'newer-isolated-run@/tmp/work/@org/newer-isolated-worktree');
  blockBoundary(run, 'commit', 'Integration merge failed through the native Git action: fixture Git lock denied the fast-forward');
  event(run, 'integration-failed', 'fixture Git lock denied the fast-forward');
  run.externalContributions = [contribution];
  event(run, 'integration-finalized', contribution.sourceRun);
  assert.throws(() => resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'An earlier completion must not resolve the newer integration failure.'), /does not complete the open failed integration/);
  assert.equal(run.boundaries!.commit!.status, 'open');
});

test('structured integration reconciliation accepts an intermediate target start and rejects a start outside its interval', context => {
  const project = fixture(context);
  const run = approved(project);
  const { contribution, intermediate } = completedTwoCommitIntegration(project, 'isolated-run');
  const record = () => ({ sourceProject: '/tmp/vanished-isolated-worktree', sourceRun: contribution.sourceRun, sourceSpecDigest: contribution.sourceSpecDigest, checkpoints: contribution.reviewedCheckpoints, commits: contribution.commits, before: intermediate, after: contribution.after, beforeIndexDigest: 'a'.repeat(64), expectedIndexDigest: 'a'.repeat(64), createdAt: new Date().toISOString() });
  event(run, 'integration-intent', `${contribution.sourceRun}@/tmp/work/@org/isolated-worktree`);
  blockIntegrationBoundary(run, record(), 'Integration merge failed through the native Git action: fixture Git lock denied the fast-forward');
  event(run, 'integration-failed', 'fixture Git lock denied the fast-forward');
  run.externalContributions = [contribution];
  event(run, 'integration-finalized', contribution.sourceRun);
  resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'The structured target-start subinterval and complete source interval are retained.');
  assert.equal(run.boundaries!.commit!.status, 'resolved');

  const invalid = approved(fixture(context));
  const invalidProject = invalid.project;
  const invalidContribution = completedIntegration(invalidProject, 'isolated-run');
  writeFileSync(path.join(invalidProject, 'later.mjs'), 'export const later = true;\n');
  captureCommand(['git', 'add', 'later.mjs'], invalidProject);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'outside interval'], invalidProject);
  const outside = checkoutState(invalidProject);
  event(invalid, 'integration-intent', `${invalidContribution.sourceRun}@/tmp/work/@org/isolated-worktree`);
  blockIntegrationBoundary(invalid, { sourceProject: '/tmp/vanished-isolated-worktree', sourceRun: invalidContribution.sourceRun, sourceSpecDigest: invalidContribution.sourceSpecDigest, checkpoints: invalidContribution.reviewedCheckpoints, commits: invalidContribution.commits, before: outside, after: invalidContribution.after, beforeIndexDigest: 'a'.repeat(64), expectedIndexDigest: 'a'.repeat(64), createdAt: new Date().toISOString() }, 'Integration merge failed through the native Git action: fixture Git lock denied the fast-forward');
  event(invalid, 'integration-failed', 'fixture Git lock denied the fast-forward');
  invalid.externalContributions = [invalidContribution];
  event(invalid, 'integration-finalized', invalidContribution.sourceRun);
  assert.throws(() => resolveCompletedIntegrationBoundary(invalid, invalidContribution.sourceRun, 'An operation start outside the source interval is not a completed integration.'), /does not complete/);
});

test('completed integration reconciliation rejects an unrelated, incomplete, or forged provenance record', context => {
  const project = fixture(context);
  const run = approved(project);
  const contribution = completedIntegration(project, 'actual-isolated-run');
  recordFailedIntegration(run, contribution.sourceRun);
  run.externalContributions = [{ ...contribution, sourceRun: 'earlier-isolated-run' }];
  event(run, 'integration-finalized', 'earlier-isolated-run');
  assert.throws(() => resolveCompletedIntegrationBoundary(run, 'earlier-isolated-run', 'A prior source must not clear this later integration failure.'), /does not complete the open failed integration/);
  run.events = run.events.filter(entry => entry.detail !== 'earlier-isolated-run');
  run.externalContributions = [contribution];
  event(run, 'integration-finalized', contribution.sourceRun);
  run.externalContributions = [{ ...contribution, after: { ...contribution.after, head: contribution.before.head } }];
  assert.throws(() => resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'An incomplete integration cannot clear the boundary.'), /interval|ancestry/);
  run.externalContributions = [{ ...contribution, commits: ['0'.repeat(40)] }];
  assert.throws(() => resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'A forged commit interval cannot clear the boundary.'), /interval|provenance/);
  run.externalContributions = [{ ...contribution, after: { ...contribution.after, files: { ...contribution.after.files, 'README.md': contribution.before.files['README.md']! } } }];
  assert.throws(() => resolveCompletedIntegrationBoundary(run, contribution.sourceRun, 'An omitted Git path cannot clear the boundary.'), /snapshot delta/);
  assert.equal(run.boundaries!.commit!.status, 'open');
});

function completedIntegration(project: string, sourceRun: string): ExternalContribution {
  const before = checkoutState(project);
  writeFileSync(path.join(project, 'README.md'), 'Completed isolated integration\n');
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'completed integration'], project);
  const after = checkoutState(project);
  const commit = captureCommand(['git', 'rev-parse', 'HEAD'], project).trim();
  return { sourceRun, sourceSpecDigest: 'a'.repeat(64), reviewedCheckpoints: ['documentation'], commits: [commit], before, after, recordedAt: new Date().toISOString() };
}

function completedRenameIntegration(project: string, sourceRun: string): ExternalContribution {
  const before = checkoutState(project);
  captureCommand(['git', 'mv', 'README.md', 'GUIDE.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'rename reviewed documentation'], project);
  const after = checkoutState(project);
  const commit = captureCommand(['git', 'rev-parse', 'HEAD'], project).trim();
  return { sourceRun, sourceSpecDigest: 'b'.repeat(64), reviewedCheckpoints: ['documentation'], commits: [commit], before, after, recordedAt: new Date().toISOString() };
}

function completedTwoCommitIntegration(project: string, sourceRun: string): { contribution: ExternalContribution; intermediate: ReturnType<typeof checkoutState> } {
  const before = checkoutState(project);
  writeFileSync(path.join(project, 'README.md'), 'First isolated commit\n');
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'first isolated commit'], project);
  const intermediate = checkoutState(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 8;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'second isolated commit'], project);
  const after = checkoutState(project);
  const commits = captureCommand(['git', 'rev-list', '--reverse', `${before.head}..${after.head}`], project).trim().split(/\s+/).filter(Boolean);
  return { contribution: { sourceRun, sourceSpecDigest: 'c'.repeat(64), reviewedCheckpoints: ['documentation'], commits, before, after, recordedAt: new Date().toISOString() }, intermediate };
}

function exhaustDeliveryRounds(run: Run): void {
  for (let round = 0; round < 2; round++) {
    blockBoundary(run, 'commit', `Earlier failed delivery ${round}`);
    resolveBoundary(run, 'commit', `Earlier native permission evidence ${round}`, false);
  }
  blockBoundary(run, 'commit', 'Earlier failed delivery escalation');
  resolveBoundary(run, 'commit', 'Earlier final escalated native evidence', true);
}

function recordFailedIntegration(run: Run, sourceRun: string, retry = false, contribution?: ExternalContribution): void {
  const cause = 'Integration merge failed through the native Git action: fixture Git lock denied the fast-forward';
  const block = () => contribution
    ? blockIntegrationBoundary(run, { sourceProject: '/tmp/vanished-isolated-worktree', sourceRun, sourceSpecDigest: contribution.sourceSpecDigest, checkpoints: contribution.reviewedCheckpoints, commits: contribution.commits, before: contribution.before, after: contribution.after, beforeIndexDigest: 'a'.repeat(64), expectedIndexDigest: 'a'.repeat(64), createdAt: new Date().toISOString() }, cause)
    : blockBoundary(run, 'commit', cause);
  event(run, 'integration-intent', `${sourceRun}@/tmp/work/@org/vanished-isolated-worktree`);
  block();
  event(run, 'integration-failed', 'fixture Git lock denied the fast-forward');
  if (retry) {
    event(run, 'checkpoint-note', 'Operator recorded context between the retained intent and its authorized retry.');
    event(run, 'review-delivered', 'A review record was delivered while the integration intent remained pending.');
    resolveBoundary(run, 'commit', 'Native authorization allowed one retry of the existing integration intent.', false);
    block();
    event(run, 'integration-failed', 'fixture Git lock denied the fast-forward');
  }
}
