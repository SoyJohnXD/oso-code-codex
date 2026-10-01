import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck, validCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { hookDecision } from '../src/hooks.ts';
import { adoptPreservedWork } from '../src/lifecycle.ts';
import { snapshot } from '../src/project.ts';
import { closeBlock } from '../src/reviews.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed } from './support.ts';

test('explicit adoption recognizes reviewed preserved work without replacing baseline or evidence', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  approved(project);
  captureCommand(['git', 'add', 'app.mjs'], project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  writeRun(run);
  const action = { cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: ['git', 'commit', '-m', 'fixture'].join(' ') } };
  assert.match(hookDecision(action).reason!, /files this run did not change/);
  const preserved = JSON.stringify({ baseline: run.baseline, blocks: run.blocks, checks: run.checks });
  const files = snapshot(project, ['app.mjs']);
  const authorization = { kind: 'user' as const, reference: 'native-adoption-request', message: 'Adopt this approved preserved file.', specDigest: run.specDigest };
  adoptPreservedWork(run, files, authorization);
  adoptPreservedWork(run, files, authorization);
  assert.equal(run.adoptions!.length, 1);
  assert.equal(JSON.stringify({ baseline: run.baseline, blocks: run.blocks, checks: run.checks }), preserved);
  assert.ok(validCheck(run, 'unit'));
  writeRun(run);
  assert.equal(hookDecision(action).allow, true);
  run.boundaries = { commit: { status: 'open', cause: 'Native approval is still pending', rounds: [] } };
  writeRun(run);
  assert.match(hookDecision(action).reason!, /Required commit remains blocked/);
});

test('adoption cannot authorize an active block or a staged version different from the reviewed worktree', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  const run = approved(project);
  adoptPreservedWork(run, snapshot(project, ['app.mjs']), { kind: 'user', reference: 'native', message: 'Adopt the preserved version.', specDigest: run.specDigest });
  writeRun(run);
  const action = { cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: ['git', 'commit', '-m', 'fixture'].join(' ') } };
  assert.match(hookDecision(action).reason!, /Close the active block/);
  await executeCheck(project, 'unit');
  const checked = readRun(project);
  reviewed(checked);
  closeBlock(checked);
  writeRun(checked);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 99;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  assert.match(hookDecision(action).reason!, /files this run did not change/);
  captureCommand(['git', 'add', 'app.mjs'], project);
  assert.equal(hookDecision(action).allow, true);
  chmodSync(path.join(project, 'app.mjs'), 0o755);
  captureCommand(['git', 'add', 'app.mjs'], project);
  assert.equal(hookDecision(action).allow, false);
  chmodSync(path.join(project, 'app.mjs'), 0o644);
  captureCommand(['git', 'add', 'app.mjs'], project);
  captureCommand(['git', 'config', 'core.filemode', 'false'], project);
  captureCommand(['git', 'update-index', '--chmod=+x', 'app.mjs'], project);
  assert.equal(hookDecision(action).allow, false);
});

test('adoption rejects an executable bit change even after staging it', context => {
  for (const staged of [false, true]) {
    const project = fixture(context);
    const run = approved(project);
    chmodSync(path.join(project, 'app.mjs'), 0o755);
    if (staged) captureCommand(['git', 'add', 'app.mjs'], project);
    assert.throws(() => adoptPreservedWork(run, snapshot(project, ['app.mjs']), { kind: 'user', reference: 'native', message: 'Adopt preserved code.', specDigest: run.specDigest }), /Git mode change/);
    assert.equal(run.adoptions, undefined);
  }
});

test('adoption refuses stale hashes, unrelated paths, committed files and missing authority atomically', context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  writeFileSync(path.join(project, 'unrelated.txt'), 'Unrelated owner work\n');
  const run = approved(project);
  const files = snapshot(project, ['app.mjs']);
  const authorization = { kind: 'user' as const, reference: 'native', message: 'Adopt the preserved version.', specDigest: run.specDigest };
  const invalidFiles: Record<string, string>[] = [{}, { 'app.mjs': '0'.repeat(64) }, { ...files, ...snapshot(project, ['unrelated.txt']) }, { '../app.mjs': files['app.mjs']! }];
  for (const invalid of invalidFiles) {
    assert.throws(() => adoptPreservedWork(run, invalid, authorization), /Adoption/);
    assert.equal(run.adoptions, undefined);
  }
  for (const invalid of [{ ...authorization, message: '' }, { ...authorization, reference: '' }, { ...authorization, specDigest: 'wrong' }]) assert.throws(() => adoptPreservedWork(run, files, invalid), /actual user authorization/);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 11;\n');
  assert.throws(() => adoptPreservedWork(run, snapshot(project, ['app.mjs']), authorization), /original baseline/);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture adoption'], project);
  assert.throws(() => adoptPreservedWork(run, files, authorization), /uncommitted change/);
});
