import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { executeCheck } from '../src/checks.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { finishAgent, registerAgent } from '../src/reviews.ts';
import { readRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

test('a third legacy correction needs an actual recovery strategy', context => {
  const project = fixture(context);
  const run = approved(project);
  for (let round = 0; round < 2; round += 1) spend(run, project, round, false);
  recordFailure(run, 'product', 'third fixture failure');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 30;\n');
  assert.throws(() => retry(run, 'Third correction', true), /strategy/i);
  assert.equal(run.blocks[0]!.rounds.length, 2);
  assert.equal(run.blocks[0]!.failure?.cause, 'third fixture failure');
  const status = recoveryStatus(run);
  recordRecoveryStrategy(run, { block: 'price', failureKey: status.failureKey!, diagnosis: { agent: run.spec.principal, report: 'The two prior corrections changed output but the checked behavior still fails.', evidence: ['unit failure log', 'current price assertion'] }, approach: 'Replace the faulty price calculation and verify the unit check.' });
  assert.equal(run.version, 3);
  assert.equal(run.readerMinimumVersion, 3);
  assert.equal(run.recovery, undefined);
  retry(run, 'Third correction after diagnosis', true);
  assert.equal(run.blocks[0]!.rounds.length, 3);
});

function spend(run: ReturnType<typeof approved>, project: string, round: number, escalated: boolean): void {
  recordFailure(run, 'product', `fixture failure ${round}`);
  writeFileSync(path.join(project, 'app.mjs'), `export const price = ${round + 10};\n`);
  retry(run, `Corrected fixture ${round}`, escalated);
}

test('a child strategy records its delivered identity without requiring copied prose', context => {
  const project = fixture(context);
  const run = approved(project);
  for (let round = 0; round < 2; round += 1) spend(run, project, round, false);
  recordFailure(run, 'product', 'child diagnosis failure');
  registerAgent(run, { id: 'diagnosis-child', role: 'explorer', tier: 'luna', scope: ['app.mjs'] });
  finishAgent(run, 'diagnosis-child', 'Observed output still differs from the required price.');
  const input = { block: 'price', failureKey: recoveryStatus(run).failureKey!, diagnosis: { agent: 'diagnosis-child', report: 'The child confirmed the pricing assertion remains unsatisfied.', evidence: ['child result', 'unit failure'] }, approach: 'Correct the price path and rerun the affected check.' };
  recordRecoveryStrategy(run, input);
  assert.equal(run.recoveryControl!.strategies[0]!.diagnosis.report, input.diagnosis.report);
  assert.equal(run.recoveryControl!.strategies[0]!.diagnosis.delivery!.report, 'Observed output still differs from the required price.');
  recordFailure(run, 'product', 'same child stale diagnosis');
  assert.throws(() => recordRecoveryStrategy(run, { ...input, failureKey: recoveryStatus(run).failureKey! }), /fresh native delivery/i);
});

test('tampered passing-check logs cannot count as recovery progress', async context => {
  const project = fixture(context);
  const specification = spec('tampered-progress');
  specification.recovery = { maxCorrections: 4 };
  approved(project, specification);
  const result = await executeCheck(project, 'unit');
  const run = readRun(project);
  assert.equal(run.recoveryControl!.progress[0]!.kind, 'check');
  assert.equal((run.recoveryControl!.progress[0] as { attempt: string }).attempt, result.attempt);
  spend(run, project, 0, false);
  spend(run, project, 1, false);
  recordFailure(run, 'product', 'third failure after recorded progress');
  writeFileSync(result.log, `${readFileSync(result.log, 'utf8')}forged\n`);
  assert.throws(() => recoveryStatus(run), /intact/i);
});
