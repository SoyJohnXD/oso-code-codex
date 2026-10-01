import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { matchesClosedCheckpoint } from '../src/contributions.ts';
import { closeExternalBlock } from '../src/external-fulfillment.ts';
import { activateBlock } from '../src/lifecycle.ts';
import { closeBlock, closeRun, finishAgent, recordReview, registerAgent } from '../src/reviews.ts';
import { readRun, stateDirectory, writeRun } from '../src/store.ts';
import type { ExternalFulfillmentInput, Run } from '../src/types.ts';
import { approved, fixture, reviewed, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('checkpoint explicitly records reviewed B fulfillment while retaining A acceptance and history', async context => {
  const { project, before, completed, resumed, mapping } = await preparedFulfillment(context);
  const accepted = resumed.checks.at(-1)!;
  checkpoint(project, mapping);
  const checkpointed = readRun(project);
  const block = checkpointed.blocks[0]!;
  assert.equal(block.externalFulfillment?.sourceRun, completed.spec.id);
  assert.equal(block.status, 'closed');
  assert.equal(checkpointed.version, 4);
  assert.equal(checkpointed.readerMinimumVersion, 4);
  assert.deepEqual(checkpointed.baseline, before.baseline);
  assert.deepEqual(checkpointed.approval, before.approval);
  assert.ok(block.reviews.at(-1)!.checkAttempts.includes(accepted.attempt));
  assert.notEqual(accepted.attempt, completed.checks[0]!.attempt);
  assert.equal(block.externalFulfillment!.acceptanceReviewId, block.reviews.at(-1)!.id);
  assert.deepEqual(block.externalFulfillments, [block.externalFulfillment]);
  assert.equal(checkpointed.recovery, undefined);
  const bytes = runtimeBytes(project);
  checkpoint(project, mapping);
  assert.deepEqual(runtimeBytes(project), bytes);
  activateBlock(checkpointed, 'remaining');
  reviewed(checkpointed);
  closeBlock(checkpointed);
  assert.throws(() => closeRun(checkpointed), /Cumulative independent/i);
  reviewCumulativeScope(checkpointed);
  closeRun(checkpointed);
  writeRun(checkpointed);
  const closedBytes = runtimeBytes(project);
  checkpoint(project, mapping);
  assert.deepEqual(runtimeBytes(project), closedBytes);
});

test('mapping rejections preserve all target state and require A acceptance', async context => {
  const { project, resumed, mapping } = await preparedFulfillment(context);
  for (const invalid of [
    { ...mapping, sourceRun: 'unimported-source' },
    { ...mapping, sourceBlocks: [] },
    { ...mapping, sourceBlocks: ['unreviewed-source-block'] },
    { ...mapping, sourceBlocks: ['source-repair', 'source-repair'] },
    { ...mapping, targetSpecDigest: '0'.repeat(64) },
    { ...mapping, sourceSpecDigest: '0'.repeat(64) },
    { ...mapping, evidence: '' },
    { ...mapping, sourceProject: project },
  ]) rejectedMapping(resumed, invalid);
  const noChecks = structuredClone(resumed);
  noChecks.checks = [];
  rejectedMapping(noChecks, mapping, /Check unit/);
  const noReview = structuredClone(resumed);
  noReview.blocks[0]!.reviews = [];
  rejectedMapping(noReview, mapping, /current independent review/);
  const failing = structuredClone(resumed);
  failing.blocks[0]!.status = 'blocked';
  rejectedMapping(failing, mapping);
  checkpoint(project, mapping);
  rejectedMapping(readRun(project), { ...mapping, evidence: 'A conflicting replacement rationale' }, /conflicts/);
  const filename = path.join(stateDirectory(project), 'conflicting-fulfillment.json');
  writeFileSync(filename, JSON.stringify({ ...mapping, evidence: 'Conflicting CLI mapping' }));
  const bytes = runtimeBytes(project);
  assert.throws(() => captureCommand([process.execPath, cli, 'checkpoint', '--file', filename], project), /conflicts/);
  assert.deepEqual(runtimeBytes(project), bytes);
});

test('partial wildcard scope cannot fulfill a broader target block', async context => {
  const { resumed, mapping } = await preparedFulfillment(context, { targetScope: ['.'] });
  rejectedMapping(resumed, mapping, /complete target scope/);
});

test('source review and check logs, checkpoint modes and current modes are verified', async context => {
  const { project, completed, resumed, mapping } = await preparedFulfillment(context);
  const report = completed.blocks[0]!.reviews[0]!.report;
  const originalReport = readFileSync(report);
  writeFileSync(report, 'Altered source review');
  rejectedMapping(resumed, mapping, /intact independent review/);
  writeFileSync(report, originalReport);
  const checkLog = completed.checks[0]!.log;
  const originalLog = readFileSync(checkLog);
  writeFileSync(checkLog, 'Altered source check log');
  rejectedMapping(resumed, mapping, /altered check logs/);
  writeFileSync(checkLog, originalLog);
  const sourceRecord = path.join(stateDirectory(project), 'runs', `${completed.spec.id}.json`);
  const originalSource = readFileSync(sourceRecord);
  completed.blocks[0]!.closedModes!['app.mjs'] = '100755';
  writeRun(completed);
  rejectedMapping(resumed, mapping, /independent review/);
  writeFileSync(sourceRecord, originalSource);
  chmodSync(path.join(project, 'app.mjs'), 0o755);
  rejectedMapping(resumed, mapping, /Git modes/);
  chmodSync(path.join(project, 'app.mjs'), 0o644);
  assert.equal(closeExternalBlock(resumed, mapping), true);
});

test('absent source paths need explicit closed deletions', async context => {
  const { completed, resumed, mapping } = await preparedFulfillment(context, { deleted: true });
  const absent = { files: {}, modes: {} };
  const sourceBlock = completed.blocks[0]!;
  assert.equal(matchesClosedCheckpoint(sourceBlock, 'unknown.txt', absent), false);
  assert.equal(matchesClosedCheckpoint(sourceBlock, 'README.md', absent), true);
  sourceBlock.closedDeletions = [];
  writeRun(completed);
  rejectedMapping(resumed, mapping, /explicit deletions/);
  sourceBlock.closedDeletions = ['README.md'];
  writeRun(completed);
  assert.equal(closeExternalBlock(resumed, mapping), true);
  assert.ok(resumed.blocks[0]!.closedDeletions!.includes('README.md'));
});

test('contribution commit intervals and current target ancestry remain binding', async context => {
  const { project, resumed, mapping } = await preparedFulfillment(context);
  for (const mutate of [
    (run: Run) => { run.externalContributions![0]!.commits = []; },
    (run: Run) => { run.externalContributions![0]!.commits = ['0'.repeat(40)]; },
    (run: Run) => { run.externalContributions![0]!.before.head = undefined; },
    (run: Run) => { run.externalContributions![0]!.after.head = '0'.repeat(40); },
  ]) {
    const invalid = structuredClone(resumed);
    mutate(invalid);
    rejectedMapping(invalid, mapping);
  }
  captureCommand(['git', 'switch', '--detach', resumed.externalContributions![0]!.before.head!], project);
  rejectedMapping(resumed, mapping, /ancestor of the current target HEAD/);
});

test('isolated source fulfillment requires both durable integration links', async context => {
  const { project, sourceProject, resumed, completed, mapping } = await preparedFulfillment(context, { isolated: true });
  const pending = structuredClone(resumed);
  pending.isolatedSuccessors![0]!.status = 'closed-pending-integration';
  rejectedMapping(pending, mapping, /completed isolated integration/);
  completed.link!.crossProject!.integration = 'pending';
  writeRun(completed);
  rejectedMapping(resumed, mapping, /completed integration/);
  completed.link!.crossProject!.integration = 'integrated';
  writeRun(completed);
  assert.equal(closeExternalBlock(resumed, mapping), true);
  assert.equal(resumed.blocks[0]!.externalFulfillment!.sourceProject, sourceProject);
  writeRun(resumed);
  assert.equal(readRun(project).version, 4);
});

test('source checkpoint evidence can come from its exact authorized roadmap family', async context => {
  const { project, resumed, completed, mapping } = await preparedFulfillment(context, { roadmapSource: true });
  const child = readRun(project, 'source-check-provider');
  assert.equal(completed.checks.length, 0);
  assert.ok(completed.blocks[0]!.reviews[0]!.checkAttempts.includes(child.checks[0]!.attempt));
  const invalid = structuredClone(child);
  invalid.approval = { kind: 'roadmap', parentRun: completed.spec.id, parentDigest: '0'.repeat(64), child: child.spec.id };
  writeRun(invalid);
  rejectedMapping(resumed, mapping, /check logs/);
  writeRun(child);
  assert.equal(closeExternalBlock(resumed, mapping), true);
  assert.notEqual(resumed.checks[0]!.attempt, child.checks[0]!.attempt);
});

test('reopen and ordinary local reclosure retain fulfillment history without an active claim', async context => {
  const { project, mapping } = await preparedFulfillment(context);
  checkpoint(project, mapping);
  const history = readRun(project).blocks[0]!.externalFulfillments;
  captureCommand([process.execPath, cli, 'reopen', '--block', 'price'], project);
  const reopened = readRun(project);
  assert.equal(reopened.blocks[0]!.externalFulfillment, undefined);
  assert.deepEqual(reopened.blocks[0]!.externalFulfillments, history);
  rejectedMapping(reopened, mapping, /reopened/);
  captureCommand([process.execPath, cli, 'checkpoint'], project);
  const locallyClosed = readRun(project);
  assert.equal(locallyClosed.blocks[0]!.status, 'closed');
  assert.equal(locallyClosed.blocks[0]!.externalFulfillment, undefined);
  assert.deepEqual(locallyClosed.blocks[0]!.externalFulfillments, history);
  assert.equal(locallyClosed.version, 4);
});

test('external fulfillment records reject older readers and malformed active provenance', async context => {
  const { project, mapping } = await preparedFulfillment(context);
  checkpoint(project, mapping);
  const valid = readRun(project);
  const filename = path.join(stateDirectory(project), 'runs', `${valid.spec.id}.json`);
  for (const mutate of [
    (run: Run) => { run.version = 2; run.readerMinimumVersion = 2; },
    (run: Run) => { run.blocks[0]!.externalFulfillments = []; },
    (run: Run) => { run.blocks[0]!.externalFulfillment!.sourceEvidenceDigest = 'invalid'; },
    (run: Run) => { run.blocks[0]!.status = 'active'; },
  ]) {
    const malformed = structuredClone(valid);
    mutate(malformed);
    const contents = JSON.stringify(malformed);
    writeFileSync(filename, contents);
    assert.throws(() => readRun(project), /fulfillment/i);
    assert.equal(readFileSync(filename, 'utf8'), contents);
  }
});

async function preparedFulfillment(context: TestContext, options: { targetScope?: string[]; deleted?: boolean; isolated?: boolean; roadmapSource?: boolean } = {}) {
  const project = fixture(context);
  const original = spec('fulfillment-a');
  original.mode = 'plan';
  original.checks[0]!.command = [process.execPath, '-e', 'import("./app.mjs").then(({price})=>{if(price!==6)throw new Error("Expected price 6")})'];
  original.blocks[0]!.scope = options.targetScope ?? (options.deleted ? ['app.mjs', 'README.md'] : ['app.mjs']);
  original.blocks.push({ ...original.blocks[0]!, id: 'remaining', dependsOn: ['price'] });
  const before = approved(project, original);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Separate approved source repair'], project);
  let sourceProject = project;
  if (options.isolated) {
    sourceProject = mkdtempSync(path.join(tmpdir(), 'oso-code-fulfillment-isolated-'));
    context.after(() => rmSync(sourceProject, { recursive: true, force: true }));
    captureCommand(['git', 'worktree', 'add', '-b', 'fulfillment-isolated', sourceProject], project);
  }
  const source = spec('fulfillment-b');
  source.blocks[0]!.id = 'source-repair';
  if (options.deleted) source.blocks[0]!.scope.push('README.md');
  source.checks = original.checks;
  if (options.roadmapSource) {
    source.mode = 'roadmap';
    const provider = spec('source-check-provider');
    provider.checks = source.checks;
    source.children = [provider];
  }
  const submission = path.join(project, '.oso-code-codex/source-approval.json');
  writeFileSync(submission, JSON.stringify({ specification: source, authorization: { kind: 'user', reference: 'fixture/source-approval', message: 'Implement the separate fixture repair' } }));
  captureCommand([process.execPath, cli, 'start', '--from-run', original.id, ...(options.isolated ? ['--from-project', project] : []), '--file', submission, '--authorization', submission], sourceProject);
  writeFileSync(path.join(sourceProject, 'app.mjs'), 'export const price = 6;\n');
  if (options.deleted) unlinkSync(path.join(sourceProject, 'README.md'));
  if (options.roadmapSource) {
    captureCommand([process.execPath, cli, 'child', 'source-check-provider'], sourceProject);
    await executeCheck(sourceProject, 'unit');
    const provider = readRun(sourceProject);
    reviewSelectedScope(provider);
    closeBlock(provider);
    closeRun(provider);
    writeRun(provider);
  }
  await executeCheck(sourceProject, 'unit');
  const completed = readRun(sourceProject);
  reviewSelectedScope(completed);
  closeBlock(completed);
  if (options.roadmapSource) reviewCumulativeScope(completed);
  closeRun(completed);
  writeRun(completed);
  captureCommand(['git', 'add', '.'], sourceProject);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'reviewed source repair'], sourceProject);
  if (options.isolated) captureCommand([process.execPath, cli, 'integrate', '--from-run', source.id, '--from-project', sourceProject], project);
  captureCommand([process.execPath, cli, 'resume', '--run', original.id], project);
  await executeCheck(project, 'unit');
  const resumed = readRun(project);
  reviewSelectedScope(resumed);
  writeRun(resumed);
  const mapping: ExternalFulfillmentInput = { block: 'price', targetSpecDigest: resumed.specDigest, sourceRun: completed.spec.id, sourceSpecDigest: completed.specDigest, sourceBlocks: ['source-repair'], evidence: 'A independently accepted the same required price behavior now implemented by the imported B checkpoint.' };
  return { project, sourceProject, before, completed: readRun(sourceProject, source.id), resumed, mapping };
}

function checkpoint(project: string, mapping: ExternalFulfillmentInput): void {
  const filename = path.join(stateDirectory(project), 'fulfillment.json');
  writeFileSync(filename, JSON.stringify(mapping));
  captureCommand([process.execPath, cli, 'checkpoint', '--file', filename], project);
}

function reviewSelectedScope(run: Run): void {
  const specification = run.spec.blocks.find(block => block.id === run.activeBlock)!;
  registerAgent(run, { id: 'native-reviewer', role: 'reviewer', tier: 'luna', scope: specification.scope });
  finishAgent(run, 'native-reviewer', 'I independently inspected the complete selected scope and current executed evidence against every required criterion.');
  recordReview(run, { agent: 'native-reviewer', kind: 'general', verdict: 'pass', criteria: specification.criteria });
}

function reviewCumulativeScope(run: Run): void {
  registerAgent(run, { id: 'cumulative-native-reviewer', role: 'reviewer', tier: 'luna', scope: run.spec.blocks.flatMap(block => block.scope) }, true);
  finishAgent(run, 'cumulative-native-reviewer', 'All approved blocks meet the complete rubric and conformance criteria with current target checks.');
  recordReview(run, { agent: 'cumulative-native-reviewer', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance'] }, true);
}

function rejectedMapping(run: Run, mapping: unknown, expected = /.+/) {
  const memory = JSON.stringify(run);
  const files = runtimeBytes(run.project);
  assert.throws(() => closeExternalBlock(run, mapping), expected);
  assert.equal(JSON.stringify(run), memory);
  assert.deepEqual(runtimeBytes(run.project), files);
}

function runtimeBytes(project: string) {
  const directory = stateDirectory(project);
  return Object.fromEntries(readdirSync(directory, { recursive: true }).map(String).sort().filter(filename => statSync(path.join(directory, filename)).isFile()).map(filename => [filename, readFileSync(path.join(directory, filename)).toString('hex')]));
}
