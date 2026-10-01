import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { hookDecision } from '../src/hooks.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { authorizeRecovery, recoveryBudget } from '../src/recovery-policy.ts';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { closeBlock, closeRun, registerAgent, upsertFinding } from '../src/reviews.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed, spec } from './support.ts';

test('a new failure at zero budget pauses both edits and appliers without blocking diagnosis', context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 1 };
  const run = approved(project, specification);
  recordFailure(run, 'product', 'price must change');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  retry(run, 'Applied the first correction', false);
  recordFailure(run, 'product', 'new independent finding needs another correction');
  writeRun(run);
  assert.equal(recoveryStatus(run).pause?.kind, 'budget');
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'apply_patch' }).allow, false);
  assert.throws(() => registerAgent(run, { id: 'next-writer', role: 'applier', tier: 'luna', scope: ['app.mjs'] }), /budget|authorization/i);
  assert.doesNotThrow(() => registerAgent(run, { id: 'diagnosis', role: 'explorer', tier: 'terra', scope: ['app.mjs'] }));
  assert.equal(hookDecision({ cwd: project, hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git status --short' } }).allow, true);
});

test('the final accepted correction verifies and closes with zero remaining budget', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 1 };
  specification.checks[0]!.command = [process.execPath, '-e', 'import("./app.mjs").then(({price})=>{if(price!==6)throw new Error("Expected price 6")})'];
  approved(project, specification);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'Fixed price against the real failing assertion' })).status, 'pass');
  const run = readRun(project);
  assert.equal(run.blocks[0]!.rounds.length, 1);
  const before = readFileSync(path.join(project, '.oso-code-codex/runs/example.json'), 'utf8');
  reviewed(run);
  closeBlock(run);
  closeRun(run);
  writeRun(run);
  assert.equal(run.status, 'closed');
  assert.equal(JSON.parse(before).blocks[0].failure, undefined);
});

test('a finite extension reopens correction but preserves failed checks and same block identity', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 1 };
  specification.checks[0]!.command = [process.execPath, '-e', 'import("./app.mjs").then(({price})=>{if(price!==7)throw new Error("Expected price 7")})'];
  approved(project, specification);
  await executeCheck(project, 'unit');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'First attempted correction observed under the assertion' })).status, 'fail');
  const blocked = readRun(project);
  const baseline = structuredClone(blocked.baseline);
  assert.equal(recoveryStatus(blocked).pause?.kind, 'budget');
  const budget = recoveryBudget(blocked);
  const input = { owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, additionalCorrections: 1, authorization: { kind: 'user', reference: 'fixture/continue-one', message: 'Continue the existing block with one additional correction', specDigest: budget.specDigest } };
  writeRun(authorizeRecovery(blocked, input));
  const extended = readRun(project);
  assert.equal(recoveryStatus(extended).canCorrect, true);
  assert.equal(extended.blocks[0]!.failure?.checkAttempt, blocked.blocks[0]!.failure?.checkAttempt);
  assert.throws(() => closeBlock(extended));
  await assert.rejects(executeCheck(project, 'unit'), /retry|repair|correct|failure/i);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'Fixed the remaining price assertion after the concrete extension' })).status, 'pass');
  const ready = readRun(project);
  assert.equal(ready.spec.id, 'example');
  assert.equal(ready.activeBlock, 'price');
  assert.deepEqual(ready.baseline, baseline);
  assert.equal(recoveryBudget(ready).remaining, 0);
  assert.equal(ready.blocks[0]!.rounds.length, 2);
  assert.throws(() => closeBlock(ready), /independent review/i);
  reviewed(ready);
  closeBlock(ready);
  closeRun(ready);
});

test('native authorization can finish the last correction without granting another one', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 1 };
  specification.checks[0]!.command = [process.execPath, '-e', 'import("node:fs").then(async fs=>{const {price}=await import("./app.mjs"); if(price!==6)throw new Error("Expected price 6"); if(!fs.existsSync(".oso-code-codex/access-granted")){console.error("EACCES: permission denied");process.exit(1)}})'];
  approved(project, specification);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  const denied = await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'Fixed the assertion in the last authorized correction' });
  assert.equal(denied.blocker, 'permission');
  assert.equal(recoveryBudget(readRun(project)).remaining, 0);
  writeFileSync(path.join(project, '.oso-code-codex/access-granted'), 'Synthetic exact native permission approval');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'permission', evidence: 'Synthetic native authorization resolved the observed linked access failure' })).status, 'pass');
  const run = readRun(project);
  assert.equal(run.blocks[0]!.rounds.length, 1);
  assert.equal(run.blocks[0]!.permissionEpisodes?.unit, undefined);
  reviewed(run);
  closeBlock(run);
  closeRun(run);
});

test('AUTO accepts a fourth cycle then requires fresh diagnosis after two cycles without progress', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 5 };
  specification.checks[0]!.command = [process.execPath, '-e', 'import("./app.mjs").then(({price})=>{if(price!==9)throw new Error("Expected price 9")})'];
  approved(project, specification);
  await executeCheck(project, 'unit');
  for (const price of [6, 7, 8, 10]) {
    if (price === 8) {
      const run = readRun(project);
      recordRecoveryStrategy(run, { block: run.activeBlock, failureKey: recoveryStatus(run).failureKey, diagnosis: { agent: run.spec.principal, report: 'Two actual numeric revisions still fail the fixed price contract; inspect the assertion before changing the export again.', evidence: [run.checks.at(-1)!.log] }, approach: 'Compare the imported price with the actual assertion target.' });
      writeRun(run);
    }
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${price};\n`);
    assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: `Observed attempted fixture correction to ${price}` })).status, 'fail');
  }
  const stagnant = readRun(project);
  assert.equal(recoveryBudget(stagnant).used, 4);
  assert.equal(recoveryBudget(stagnant).remaining, 1);
  assert.equal(recoveryStatus(stagnant).pause?.kind, 'stagnation');
  const filename = path.join(project, '.oso-code-codex/runs/example.json');
  const before = readFileSync(filename, 'utf8');
  await assert.rejects(executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'A flag alone is not another diagnostic outcome', escalated: true }), /diagnosis|strategy/i);
  assert.equal(readFileSync(filename, 'utf8'), before);
  recordRecoveryStrategy(stagnant, { block: stagnant.activeBlock, failureKey: recoveryStatus(stagnant).failureKey, diagnosis: { agent: stagnant.spec.principal, report: 'Actual attempts for values 8 and 10 both failed. The assertion explicitly requires 9; numeric guessing has not made progress.', evidence: [stagnant.checks.at(-1)!.log, stagnant.checks.at(-2)!.log] }, approach: 'Set the exact asserted value 9, then execute the unchanged assertion.' });
  writeRun(stagnant);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 9;\n');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'Applied the new evidenced strategy to the final authorized cycle' })).status, 'pass');
  const ready = readRun(project);
  assert.equal(recoveryBudget(ready).used, 5);
  assert.equal(ready.recovery?.grants?.length, 0);
  reviewed(ready);
  closeBlock(ready);
  closeRun(ready);
});

test('reopening a finding preserves its earlier evidenced progress without breaking recovery status', context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 5 };
  const run = approved(project, specification);
  const finding = { id: 'price-contract', rule: 'conformance', evidence: 'The price export is inconsistent with its consumer' };
  upsertFinding(run, { ...finding, disposition: 'open' });
  upsertFinding(run, { ...finding, disposition: 'fixed', resolution: 'The consumer and its source were reconciled at this checkpoint' });
  for (const price of [6, 7]) {
    recordFailure(run, 'product', `Actual next fixture correction ${price}`);
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${price};\n`);
    retry(run, `Revised the price fixture to ${price}`, false);
  }
  upsertFinding(run, { ...finding, disposition: 'open' });
  recordFailure(run, 'product', 'The contract finding was reopened with fresh evidence');
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
  assert.equal(run.recoveryControl!.progress.length, 1);
});
