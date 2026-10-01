import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck, validCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { hookDecision } from '../src/hooks.ts';
import { adoptPreservedWork } from '../src/lifecycle.ts';
import { checkFingerprint, snapshot } from '../src/project.ts';
import { closeBlock } from '../src/reviews.ts';
import { parseSpec } from '../src/schema.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed, spec } from './support.ts';

test('resumed evidence survives equivalent PATH lookup order but detects executable shadowing', async context => {
  const project = fixture(context);
  const originalPath = process.env.PATH;
  context.after(() => { process.env.PATH = originalPath; });
  const first = path.join(project, 'first');
  const second = path.join(project, 'second');
  mkdirSync(first);
  mkdirSync(second);
  writeFileSync(path.join(first, 'fixture-tool'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(path.join(second, 'fixture-other'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const alias = path.join(project, 'alias');
  symlinkSync(first, alias);
  process.env.PATH = [first, second, originalPath].join(path.delimiter);
  approved(project);
  const result = await executeCheck(project, 'unit');
  process.env.PATH = [second, alias, first, originalPath].join(path.delimiter);
  assert.equal(validCheck(readRun(project), 'unit')?.attempt, result.attempt);
  assert.equal((await executeCheck(project, 'unit')).reused, true);
  assert.equal(readRun(project).checks.length, 1);
  writeFileSync(path.join(second, 'fixture-tool'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.equal(validCheck(readRun(project), 'unit'), undefined);
  process.env.PATH = [first, second, originalPath].join(path.delimiter);
  assert.equal(validCheck(readRun(project), 'unit')?.attempt, result.attempt);
  chmodSync(path.join(first, 'fixture-tool'), 0o644);
  assert.equal(validCheck(readRun(project), 'unit'), undefined);
});

test('explicit internal check helpers affect proof while technical run records stay excluded', context => {
  const project = fixture(context);
  approved(project);
  const helper = path.join(project, '.oso-code-codex/check-local.cjs');
  writeFileSync(helper, 'process.exit(0);');
  const check = spec().checks[0]!;
  check.inputs.push('.oso-code-codex/check-local.cjs');
  const before = checkFingerprint(project, check);
  writeFileSync(path.join(project, '.oso-code-codex/notes.json'), '{"next":"review"}');
  assert.equal(checkFingerprint(project, check), before);
  writeFileSync(helper, 'process.exit(1);');
  assert.notEqual(checkFingerprint(project, check), before);
  assert.equal(Object.keys(snapshot(project)).some(name => name.startsWith('.oso-code-codex/')), false);
  for (const input of ['runs/example.json', 'logs/example.log', 'reviews/report.txt', 'locks/owner.json', 'active', 'transaction.lock/owner.json', 'memory-pending.json']) {
    const specification = spec();
    specification.checks[0]!.inputs = [`.oso-code-codex/${input}`];
    assert.throws(() => parseSpec(specification), /Runtime records cannot be check inputs/);
    assert.throws(() => checkFingerprint(project, specification.checks[0]!), /Runtime records cannot be check inputs/);
    assert.throws(() => snapshot(project, specification.checks[0]!.inputs, true), /Runtime records cannot be check inputs/);
  }
});

test('hook treats quoted test fixtures and command mentions as data', context => {
  const project = fixture(context);
  approved(project);
  const commands = [
    'printf "%s\\n" "git commit -m example"',
    "node -e 'const example = \"git commit -m fixture\"; console.log(example)'",
    "python3 - <<'PY'\nexample = \"git commit -m fixture\"\nprint(example)\nPY",
    'cat <<EOF\ngit push\nnpm publish\nEOF',
    '# git commit -m example\ngit status',
    'rg "git commit|git push|vercel deploy" test',
    "bash -lc 'printf \"git commit\"'",
  ];
  for (const command of commands) assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }).allow, true, command);
});

test('hook still checks actual command positions and explicit shell execution', context => {
  const project = fixture(context);
  approved(project);
  const commands = [
    'git status && git commit -m fixture',
    'env CI=1 git -c user.name=Fixture commit -m fixture',
    "bash -lc 'git commit -m fixture'",
    'echo "$(git commit -m fixture)"',
    'echo `git push`',
    'cat <<EOF\n$(git push)\nEOF',
    'cat <<\'EOF\'\ngit commit\nEOF\ngit push',
    'git -C app --no-pager push',
    '/usr/bin/git commit -m fixture',
    'npm publish',
    '2>/dev/null git push',
    'time git commit -m fixture',
    'nice git push',
    'command time git commit -m fixture',
    'time -f "%e" -o /tmp/fixture-time git push',
    'nice --adjustment 5 git push',
  ];
  for (const command of commands) assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }).allow, false, command);
});

test('literal PATH contracts and explicit executable changes invalidate evidence', context => {
  const project = fixture(context);
  const original = process.env.PATH;
  context.after(() => { process.env.PATH = original; });
  const specification = spec();
  const check = specification.checks[0]!;
  check.pathMode = 'literal';
  assert.equal(parseSpec(specification).checks[0]!.pathMode, 'literal');
  const first = checkFingerprint(project, check);
  process.env.PATH = [original, original].join(path.delimiter);
  assert.notEqual(checkFingerprint(project, check), first);
  check.pathMode = 'lookup';
  const tool = path.join(project, 'direct-tool');
  writeFileSync(tool, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  check.command = [tool];
  const executable = checkFingerprint(project, check);
  writeFileSync(tool, '#!/bin/sh\nexit 1\n');
  assert.notEqual(checkFingerprint(project, check), executable);
  assert.throws(() => parseSpec({ ...specification, checks: [{ ...check, pathMode: 'sort' }] }), /pathMode/);
});

test('one hook request enforces both commit readiness and publication authority', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  writeRun(run);
  const invoke = (command: string) => hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  assert.equal(invoke('git commit -m fixture').allow, true);
  assert.equal(invoke('git commit -m fixture && git push').allow, false);
});

test('ordinary owned changes cannot commit a staged version different from the reviewed source', async context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  writeRun(run);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 99;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  const input = { cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m fixture' } };
  assert.match(hookDecision(input).reason!, /index differs/);
  captureCommand(['git', 'add', 'app.mjs'], project);
  assert.equal(hookDecision(input).allow, true);
});

test('legacy opaque fingerprints remain historical records and are never upgraded to new proof', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  run.checks[0]!.fingerprint = run.checks[0]!.fingerprint.slice(3);
  assert.equal(validCheck(run, 'unit'), undefined);
  assert.equal(run.checks[0]!.status, 'pass');
  writeRun(run);
  const status = JSON.parse(captureCommand([process.execPath, path.resolve('src/cli.ts'), 'status'], project));
  assert.match(status.checks[0].refreshReason, /once in its existing block/);
  assert.deepEqual(readRun(project).checks, run.checks);
});

test('adoption cannot attach a future unreviewed file to a different block checkpoint', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'README.md'), 'Preserved documentation change');
  const specification = spec();
  specification.mode = 'plan';
  specification.blocks.push({ ...specification.blocks[0]!, id: 'docs', goal: 'Review the preserved documentation', scope: ['README.md'] });
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  adoptPreservedWork(run, snapshot(project, ['README.md']), { kind: 'user', reference: 'actual-fixture-turn', message: 'Include the preserved documentation in its approved block.', specDigest: run.specDigest });
  writeRun(run);
  captureCommand(['git', 'add', 'README.md'], project);
  const input = { cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m fixture' } };
  assert.match(hookDecision(input).reason!, /no matching reviewed checkpoint/);
});
