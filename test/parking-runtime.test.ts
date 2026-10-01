import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { parkRun, transitionStatus } from '../src/parking.ts';
import { closeBlock } from '../src/reviews.ts';
import { readRun, transaction, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed } from './support.ts';

test('park lifecycle promotes the record once and retains the selected block evidence', context => {
  const project = fixture(context);
  const original = approved(project);
  transaction(project, () => {
    parkRun(original, 'An independently approved correction must use this checkout next');
    writeRun(original);
  });
  const parked = readRun(project);
  assert.equal(parked.version, 2);
  assert.equal(parked.readerMinimumVersion, 2);
  assert.equal(parked.status, 'parked');
  assert.equal(parked.parked!.selectedBlock, 'price');
  assert.deepEqual(parked.parked!.globalBaseline, original.baseline);
  assert.deepEqual(parked.blocks, original.blocks);
});

test('transition readback reports parking eligibility without taking a transaction lock', context => {
  const project = fixture(context);
  approved(project);
  const transitions = transitionStatus(project) as { transitions: Array<{ id: string; park: { eligible: boolean } }> };
  assert.equal(transitions.transitions[0]!.id, 'example');
  assert.equal(transitions.transitions[0]!.park.eligible, true);
});

test('a mode-only change after review cannot close a block with stale review provenance', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  chmodSync(`${project}/app.mjs`, 0o755);
  assert.throws(() => closeBlock(run), /current independent review/);
});
