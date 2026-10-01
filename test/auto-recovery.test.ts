import assert from 'node:assert/strict';
import test from 'node:test';
import { activateBlock, authorize, startRun } from '../src/lifecycle.ts';
import { recoveryStatus } from '../src/recovery-control.ts';
import { recordFailure } from '../src/recovery.ts';
import { fixture, spec } from './support.ts';

test('an auto recovery policy does not turn preserved corrections into a budget pause', context => {
  const project = fixture(context);
  const specification = spec('auto-recovery');
  specification.recovery = { mode: 'auto' };
  const run = startRun(project, specification);
  assert.equal(run.version, 4);
  assert.equal(run.readerMinimumVersion, 4);
  authorize(run, { kind: 'user', reference: 'fixture-native-turn', message: 'Implement the presented fixture plan', specDigest: run.specDigest });
  activateBlock(run, 'price');
  run.blocks[0]!.rounds.push(
    { kind: 'product', cause: 'first preserved correction', evidence: 'first repair', escalated: false, signature: 'first', at: '2026-09-16T00:00:00.000Z' },
    { kind: 'product', cause: 'second preserved correction', evidence: 'second repair', escalated: false, signature: 'second', at: '2026-09-16T00:01:00.000Z' },
    { kind: 'product', cause: 'third preserved correction', evidence: 'third repair', escalated: false, signature: 'third', at: '2026-09-16T00:02:00.000Z' },
  );
  recordFailure(run, 'product', 'a later failure still needs diagnosis');

  assert.notEqual(recoveryStatus(run).pause?.kind, 'budget');
});
