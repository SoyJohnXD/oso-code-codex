import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { hookDecision } from '../src/hooks.ts';
import { startRun } from '../src/lifecycle.ts';
import { closeBlock } from '../src/reviews.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed, spec } from './support.ts';

test('edits need approval and an active block; ordinary reads and pipelines remain usable', context => {
  const project = fixture(context);
  startRun(project, spec());
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'apply_patch' }).allow, false);
  for (const command of ['env NODE_ENV=test npm test', 'cd src && rg price . | head', 'node -e "console.log(42)"', 'fallow --help', 'git status --short']) {
    assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }).allow, true, command);
  }
});

test('unapproved publication and commits are protected without a global tool allowlist', context => {
  const project = fixture(context);
  approved(project);
  for (const command of ['git commit -m fix', 'git -C app push', 'npm publish', 'vercel deploy']) assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }).allow, false, command);
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'new_read_tool' }).allow, true);
});

test('late source edits invalidate commit readiness after successful review', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  writeRun(run);
  const command = { cwd: project, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m fix' } };
  assert.equal(hookDecision(command).allow, true);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 99;');
  assert.equal(hookDecision(command).allow, false);
});

test('repository subdirectories retain the same approval and publication guards', context => {
  const project = fixture(context);
  startRun(project, spec());
  const cwd = path.join(project, 'src');
  mkdirSync(cwd);
  assert.equal(hookDecision({ cwd, hook_event_name: 'PreToolUse', tool_name: 'apply_patch' }).allow, false);
  assert.equal(hookDecision({ cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } }).allow, false);
});

test('pending approval permits metadata preparation while protecting authoritative records', context => {
  const project = fixture(context);
  startRun(project, spec());
  for (const [filename, allowed] of [['.oso-code-codex/approval.json', true], ['.oso-code-codex/runs/example.json', false], ['.oso-code-codex/active', false], ['price.mjs', false]] as const) {
    assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: ${filename}\n+{}\n*** End Patch` } }).allow, allowed, filename);
  }
});

test('unsupported state keeps diagnosis usable and gives a specific protected-action decision', context => {
  const project = fixture(context);
  const run = approved(project);
  writeFileSync(path.join(project, '.oso-code-codex/runs/example.json'), JSON.stringify({ ...run, version: 4, readerMinimumVersion: 4 }));
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git status --short' } }).allow, true);
  const decision = hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'apply_patch' });
  assert.equal(decision.allow, false);
  assert.match(decision.reason!, /unsupported|reader version|Version 4|policy state/i);
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git commit -m change' } }).allow, false);
});

test('a damaged progress log returns an explicit deny while read-only diagnosis remains available', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 4 };
  approved(project, specification);
  const check = await executeCheck(project, 'unit');
  const run = readRun(project);
  for (const price of [6, 7]) {
    recordFailure(run, 'product', `Subsequent price issue ${price}`);
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${price};\n`);
    retry(run, `Repaired the subsequent price issue ${price}`, false);
  }
  recordFailure(run, 'product', 'Review the remaining price issue');
  writeRun(run);
  writeFileSync(check.log, 'Damaged historical progress log');
  const decision = hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'apply_patch' });
  assert.equal(decision.allow, false);
  assert.match(decision.reason!, /intact|log/i);
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git status --short' } }).allow, true);
});
