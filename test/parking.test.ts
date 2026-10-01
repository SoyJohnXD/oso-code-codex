import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { blockBoundary, resolveBoundary } from '../src/boundaries.ts';
import { executeCheck } from '../src/checks.ts';
import { hookDecision } from '../src/hooks.ts';
import { startRun } from '../src/lifecycle.ts';
import { closeBlock, closeRun } from '../src/reviews.ts';
import { acquireLock, readRun, writeRun } from '../src/store.ts';
import { approved, closeDocumentationCorrection, fixture, reviewed, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('parking retains the approved selected block and evidence, then resumes the same identity', context => {
  const project = fixture(context);
  const original = approved(project);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Execute a separate approved correction'], project);
  const parked = readRun(project);
  assert.equal(parked.status, 'parked');
  assert.equal(parked.version, 2);
  assert.equal(parked.activeBlock, original.activeBlock);
  assert.deepEqual(parked.baseline, original.baseline);
  assert.deepEqual(parked.approval, original.approval);
  assert.deepEqual(parked.blocks, original.blocks);
  assert.equal(readFileSync(path.join(project, '.oso-code-codex/active'), 'utf8').trim(), original.spec.id);
  captureCommand([process.execPath, cli, 'resume', '--run', original.spec.id], project);
  assert.equal(readRun(project).status, 'running');
  assert.equal(readRun(project).version, 2);
});

test('transition status is read-only even while another runtime transaction owns its lock', context => {
  const project = fixture(context);
  approved(project);
  const before = readFileSync(path.join(project, '.oso-code-codex/runs/example.json'), 'utf8');
  const release = acquireLock(path.join(project, '.oso-code-codex/transaction.lock'));
  try {
    const result = JSON.parse(captureCommand([process.execPath, cli, 'status', '--transitions'], project));
    assert.ok(result.transitions);
  } finally { release(); }
  assert.equal(readFileSync(path.join(project, '.oso-code-codex/runs/example.json'), 'utf8'), before);
});

test('a parked run cannot execute checks or permit edits through its old authorization', context => {
  const project = fixture(context);
  approved(project);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Separate objective'], project);
  assert.throws(() => captureCommand([process.execPath, cli, 'check', 'unit'], project), /parked/i);
  assert.equal(hookDecision({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'apply_patch', tool_input: '*** Update File: app.mjs\n' }).allow, false);
  assert.equal(hookDecision({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: { command: 'git commit -m premature' } }).allow, false);
});

test('clean A B A preserves original ownership while excluding only the reviewed external contribution', async context => {
  const project = fixture(context);
  const original = approved(project);
  startDocumentationCorrection(project);
  await closeDocumentationCorrection(project);
  captureCommand([process.execPath, cli, 'resume', '--run', original.spec.id], project);
  let resumed = readRun(project);
  assert.deepEqual(resumed.baseline, original.baseline);
  assert.deepEqual(resumed.blocks[0]!.baseline, original.blocks[0]!.baseline);
  assert.deepEqual(resumed.approval, original.approval);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Temporarily stop before pricing implementation'], project);
  captureCommand([process.execPath, cli, 'resume', '--run', original.spec.id], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  await executeCheck(project, 'unit');
  resumed = readRun(project);
  reviewed(resumed);
  closeBlock(resumed);
  closeRun(resumed);
  writeRun(resumed);
  assert.equal(readRun(project).status, 'closed');
  assert.equal(readFileSync(path.join(project, 'README.md'), 'utf8'), 'Corrected documentation\n');
});

test('an unreviewed external commit cannot become A baseline when returning from B', async context => {
  const project = fixture(context);
  const original = approved(project);
  startDocumentationCorrection(project);
  await closeDocumentationCorrection(project);
  writeFileSync(path.join(project, 'README.md'), 'Unreviewed external replacement\n');
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'unreviewed'], project);
  assert.throws(() => captureCommand([process.execPath, cli, 'resume', '--run', original.spec.id], project));
  assert.equal(readRun(project, original.spec.id).status, 'parked');
  assert.deepEqual(readRun(project, original.spec.id).baseline, original.baseline);
});

test('an unreviewed external mode change cannot be absorbed as reviewed content', async context => {
  const project = fixture(context);
  const original = approved(project);
  startDocumentationCorrection(project);
  await closeDocumentationCorrection(project);
  chmodSync(path.join(project, 'README.md'), 0o755);
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'unreviewed-mode'], project);
  assert.throws(() => captureCommand([process.execPath, cli, 'resume', '--run', original.spec.id], project));
  assert.equal(readRun(project, original.spec.id).status, 'parked');
});

test('a delivery recovery in B retains its budget when A resumes', async context => {
  const project = fixture(context);
  approved(project);
  startDocumentationCorrection(project);
  const correction = readRun(project);
  blockBoundary(correction, 'commit', 'Synthetic native permission denial');
  resolveBoundary(correction, 'commit', 'Synthetic explicit native authorization for the fixture commit', false);
  writeRun(correction);
  await closeDocumentationCorrection(project);
  captureCommand([process.execPath, cli, 'resume', '--run', 'example'], project);
  const resumed = readRun(project);
  assert.equal(resumed.boundaries?.commit?.rounds.length, 1);
  assert.equal(resumed.boundaries?.commit?.status, 'resolved');
});

test('an approved prerequisite can precede a selected but untouched block without parking or replacing its identity', context => {
  const project = fixture(context);
  const original = approved(project);
  insertPrerequisite(project);
  assert.equal(readRun(project).activeBlock, undefined);
  assert.equal(readRun(project).blocks.find(block => block.id === 'price')!.status, 'pending');
  captureCommand([process.execPath, cli, 'activate', 'documentation'], project);
  assert.equal(readRun(project).activeBlock, 'documentation');
  assert.deepEqual(readRun(project).baseline, original.baseline);
});

test('a selected block with a mode-only edit cannot be treated as untouched', context => {
  const project = fixture(context);
  approved(project);
  chmodSync(path.join(project, 'app.mjs'), 0o755);
  try { insertPrerequisite(project); } catch (error) { assert.match(String(error), /active|untouched|started|mode|prerequisite/i); }
  assert.equal(readRun(project).activeBlock, 'price');
  assert.throws(() => captureCommand([process.execPath, cli, 'activate', 'documentation'], project));
});

test('historical mode-less review stays historical without blocking a new current review', async context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  delete run.blocks[0]!.reviews[0]!.scopeModes;
  reviewed(run, 'Current independent fixture review explicitly covers the current Git modes and pricing.');
  closeBlock(run);
  assert.equal(run.blocks[0]!.status, 'closed');
  assert.equal(run.blocks[0]!.reviews.length, 2);
});

test('the successor is linked in its initial persisted record before selection returns', context => {
  const project = fixture(context);
  approved(project);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Separate correction'], project);
  const successor = startRun(project, { ...spec('linked'), objective: 'Separate approved objective' }, { parkedPredecessor: 'example' });
  assert.equal(successor.link?.parkedRun, 'example');
  assert.equal(readRun(project).link?.parkedRun, 'example');
  assert.equal(readRun(project).version, 2);
});

test('a mode-only change outside A scope is rejected after a reviewed B contribution', async context => {
  const project = fixture(context);
  approved(project);
  startDocumentationCorrection(project);
  await closeDocumentationCorrection(project);
  captureCommand([process.execPath, cli, 'resume', '--run', 'example'], project);
  chmodSync(path.join(project, 'README.md'), 0o755);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  assert.throws(() => closeBlock(run), /outside approved block scope/);
});

test('a historical checkpoint without mode evidence cannot authorize a commit', async context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  delete run.blocks[0]!.closedModes;
  writeRun(run);
  chmodSync(path.join(project, 'app.mjs'), 0o755);
  captureCommand(['git', 'add', 'app.mjs'], project);
  const decision = hookDecision({ hook_event_name: 'PreToolUse', cwd: project, tool_name: 'Bash', tool_input: { command: 'git commit -m changed' } });
  assert.equal(decision.allow, false);
  assert.match(decision.reason!, /mode/i);
});

function insertPrerequisite(project: string): void {
  const amended = spec();
  amended.blocks[0]!.dependsOn = ['documentation'];
  amended.blocks.unshift({ id: 'documentation', goal: 'Establish the documentation prerequisite', scope: ['README.md'], criteria: ['rubric', 'conformance'], checks: ['unit'] });
  const filename = path.join(project, '.oso-code-codex/amendment.json');
  writeFileSync(filename, JSON.stringify({ specification: amended, authorization: { kind: 'user', reference: 'fixture-amendment', message: 'Add the documentation prerequisite before pricing' } }));
  captureCommand([process.execPath, cli, 'amend', '--file', filename, '--authorization', filename], project);
}

function startDocumentationCorrection(project: string): void {
  captureCommand([process.execPath, cli, 'park', '--reason', 'Separate documentation correction'], project);
  const correction = spec('documentation');
  correction.objective = 'Correct the documentation';
  correction.blocks[0]!.scope = ['README.md'];
  correction.checks[0]!.inputs = ['README.md'];
  correction.checks[0]!.command = [process.execPath, '-e', 'require("node:assert/strict").equal(require("node:fs").readFileSync("README.md", "utf8"), "Corrected documentation\\n")'];
  const submission = path.join(project, '.oso-code-codex/correction.json');
  writeFileSync(submission, JSON.stringify({ specification: correction, authorization: { kind: 'user', reference: 'fixture-correction-approval', message: 'Implement the separate documentation correction' } }));
  captureCommand([process.execPath, cli, 'start', '--file', submission, '--authorization', submission, '--from-run', 'example'], project);
}
