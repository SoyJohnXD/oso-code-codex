import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { promoteRecoveryRecord } from '../src/lifecycle.ts';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { adoptRecoveryPolicy } from '../src/recovery-policy.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { selectRoadmapChild } from '../src/roadmap.ts';
import { upsertFinding } from '../src/reviews.ts';
import { readRun, writeRun } from '../src/store.ts';
import type { CheckResult, RecoveryStrategy, Run } from '../src/types.ts';
import { approved, fixture, spec } from './support.ts';

function measuredSpec() {
  const specification = spec('auto-progress');
  specification.recovery = { mode: 'auto' };
  specification.checks[0]!.command = [process.execPath, '--input-type=module', '-e', 'import { price } from "./app.mjs"; console.log(price); process.exit(price === 0 ? 0 : 1)'];
  return specification;
}

function repair(run: Run, price: number): void {
  const round = run.blocks[0]!.rounds.length + 1;
  writeFileSync(path.join(run.project, 'app.mjs'), `export const price = ${price};\nexport const revision = ${round};\n`);
  retry(run, `Changed the price calculation in correction ${round}`, false);
  writeRun(run);
}

function diagnose(run: Run, report: string, progress?: RecoveryStrategy['progress']): void {
  recordRecoveryStrategy(run, {
    block: 'price', failureKey: recoveryStatus(run).failureKey!,
    diagnosis: { agent: run.spec.principal, report, evidence: ['The current fixture output and recorded failure identify the price path.'] },
    approach: `Repair the calculation identified by: ${report}`, ...(progress ? { progress } : {}),
  });
}

function measurement(before: CheckResult, after: CheckResult): NonNullable<RecoveryStrategy['progress']> {
  return { beforeAttempt: before.attempt, afterAttempt: after.attempt, metric: 'remaining-failures', before: Number(readFileSync(before.log, 'utf8').trim()), after: Number(readFileSync(after.log, 'utf8').trim()), evidence: [before.log, after.log] };
}

function legacyRoadmapChild(project: string) {
  const specification = measuredSpec();
  delete specification.recovery;
  const roadmap = spec('adopting-progress-root');
  roadmap.mode = 'roadmap';
  roadmap.children = [specification];
  const root = approved(project, roadmap);
  const child = selectRoadmapChild(project, root.spec.id, specification.id);
  child.version = 2;
  delete child.readerMinimumVersion;
  delete child.roadmapLineage;
  writeRun(child);
  assert.equal(child.version, 2);
  assert.equal(child.recovery, undefined);
  assert.equal(child.recoveryControl, undefined);
  return { root, child };
}

function adoptRootAuto(root: Run): void {
  const budget = recoveryStatus(root);
  adoptRecoveryPolicy(root, {
    owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, policy: { mode: 'auto' },
    authorization: { kind: 'user', reference: 'fixture-inherited-auto', message: 'Adopt AUTO for the existing roadmap family', specDigest: budget.specDigest },
  });
  writeRun(root);
}

test('a pre-existing policy-less child credits a required passing check after root AUTO adoption', async context => {
  const project = fixture(context);
  const { root } = legacyRoadmapChild(project);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  let child = readRun(project);
  repair(child, 4);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  adoptRootAuto(root);
  child = readRun(project);
  assert.equal(child.recovery, undefined);
  assert.equal(child.recoveryControl, undefined);
  assert.equal(recoveryStatus(child).owner, root.spec.id);
  assert.equal(recoveryStatus(child).policy?.mode, 'auto');
  repair(child, 0);
  const passed = await executeCheck(project, 'unit');
  assert.equal(passed.status, 'pass');
  child = readRun(project);
  assert.equal(child.recoveryControl!.progress.length, 1);
  assert.deepEqual(child.recoveryControl!.progress[0], {
    kind: 'check', attempt: passed.attempt, block: 'price', round: 2, at: child.recoveryControl!.progress[0]!.at,
  });
  recordFailure(child, 'product', 'An independent outstanding price case remains');
  assert.equal(recoveryStatus(child).pause, undefined);
  promoteRecoveryRecord(child, 3);
  writeRun(child);
  assert.equal(readRun(project).version, 4);
  assert.equal(readRun(project).readerMinimumVersion, 4);
});

test('a pre-existing policy-less child credits an existing finding resolved after root AUTO adoption', context => {
  const project = fixture(context);
  const { root, child } = legacyRoadmapChild(project);
  const finding = { id: 'inherited-price', rule: 'conformance', evidence: 'The original negative-price branch violates the approved behavior.' };
  upsertFinding(child, { ...finding, disposition: 'open' });
  for (const price of [6, 7]) {
    recordFailure(child, 'product', `The original child price case ${price} fails`);
    repair(child, price);
  }
  recordFailure(child, 'product', 'The original child finding is still unresolved');
  writeRun(child);
  adoptRootAuto(root);
  const inherited = readRun(project);
  assert.equal(inherited.recovery, undefined);
  assert.equal(inherited.recoveryControl, undefined);
  assert.equal(recoveryStatus(inherited).pause?.kind, 'stagnation');
  upsertFinding(inherited, { ...finding, disposition: 'fixed', resolution: 'Repaired the original negative-price branch.' });
  assert.equal(inherited.recoveryControl!.progress.length, 1);
  assert.equal(inherited.recoveryControl!.progress[0]!.kind, 'finding');
  assert.equal(inherited.recoveryControl!.progress[0]!.round, 2);
  assert.equal(recoveryStatus(inherited).pause, undefined);
  promoteRecoveryRecord(inherited, 3);
  writeRun(inherited);
  assert.equal(readRun(project).version, 4);
  assert.equal(readRun(project).readerMinimumVersion, 4);
});

test('AUTO credits a required fail-to-pass once and revokes credit after a regression', async context => {
  const project = fixture(context);
  approved(project, measuredSpec());
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  let run = readRun(project);
  repair(run, 0);
  const passed = await executeCheck(project, 'unit');
  run = readRun(project);
  assert.equal(run.recoveryControl!.progress.length, 1);
  assert.equal(run.recoveryControl!.progress[0]!.round, 1);
  assert.equal((await executeCheck(project, 'unit')).attempt, passed.attempt);

  recordFailure(run, 'product', 'A second input exposes a price regression');
  repair(run, 6);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  run = readRun(project);
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
  diagnose(run, 'The second input bypasses the corrected calculation');
  repair(run, 0);
  assert.equal((await executeCheck(project, 'unit')).status, 'pass');
  run = readRun(project);
  assert.equal(run.recoveryControl!.progress.length, 1);
  recordFailure(run, 'product', 'A separate outstanding price case needs correction');
  repair(run, 0);
  assert.equal((await executeCheck(project, 'unit')).status, 'pass');
  run = readRun(project);
  recordFailure(run, 'product', 'The outstanding case still fails');
  assert.equal(run.recoveryControl!.progress.length, 1);
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
});

test('AUTO does not credit an initially green check or repeated green checks', async context => {
  const project = fixture(context);
  const specification = measuredSpec();
  specification.checks[0]!.command = [process.execPath, '-e', 'console.log("PASS")'];
  approved(project, specification);
  await executeCheck(project, 'unit');
  let run = readRun(project);
  assert.equal(run.recoveryControl?.progress.length ?? 0, 0);
  for (const price of [6, 7]) {
    recordFailure(run, 'product', `Unchecked price case ${price}`);
    repair(run, price);
    await executeCheck(project, 'unit');
    run = readRun(project);
  }
  recordFailure(run, 'product', 'The unchecked behavior still fails');
  assert.equal(run.recoveryControl?.progress.length ?? 0, 0);
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
});

for (const tampered of [false, true]) test(`AUTO requires intact reproduced failure evidence for fail-to-pass credit: tampered=${tampered}`, async context => {
  const project = fixture(context);
  approved(project, measuredSpec());
  const red = await executeCheck(project, 'unit', true);
  assert.equal(red.status, 'reproduced');
  if (tampered) writeFileSync(red.log, 'forged red evidence\n');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 0;\n');
  assert.equal((await executeCheck(project, 'unit')).status, 'pass');
  const run = readRun(project);
  assert.equal(run.recoveryControl?.progress.length ?? 0, tampered ? 0 : 1);
});

test('tampering with a prior failure revokes otherwise current AUTO passing credit', async context => {
  const project = fixture(context);
  approved(project, measuredSpec());
  const failed = await executeCheck(project, 'unit');
  let run = readRun(project);
  repair(run, 0);
  await executeCheck(project, 'unit');
  run = readRun(project);
  recordFailure(run, 'product', 'Another price case remains');
  repair(run, 0);
  recordFailure(run, 'product', 'The remaining case still fails');
  assert.equal(recoveryStatus(run).pause, undefined);
  writeFileSync(failed.log, 'tampered original failure\n');
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
});

test('adopting AUTO cannot turn repeated legacy fail-to-pass credits into new progress', async context => {
  const project = fixture(context);
  const specification = measuredSpec();
  specification.recovery = { maxCorrections: 10 };
  approved(project, specification);
  await executeCheck(project, 'unit');
  let run = readRun(project);
  repair(run, 0);
  await executeCheck(project, 'unit');
  run = readRun(project);
  recordFailure(run, 'product', 'Legacy regression');
  repair(run, 6);
  await executeCheck(project, 'unit');
  run = readRun(project);
  diagnose(run, 'Legacy diagnosis of the regressed price path');
  repair(run, 0);
  await executeCheck(project, 'unit');
  run = readRun(project);
  assert.equal(run.recoveryControl!.progress.length, 2);
  const budget = recoveryStatus(run);
  adoptRecoveryPolicy(run, { owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, policy: { mode: 'auto' }, authorization: { kind: 'user', reference: 'fixture-auto-adoption', message: 'Adopt AUTO for this fixture', specDigest: budget.specDigest } });
  recordFailure(run, 'product', 'First post-adoption failure');
  repair(run, 0);
  await executeCheck(project, 'unit');
  run = readRun(project);
  recordFailure(run, 'product', 'The outstanding post-adoption case still fails');
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
  assert.equal(run.version, 4);
});

test('reopening and resolving a finding revokes its AUTO credit without breaking status', context => {
  const project = fixture(context);
  const run = approved(project, measuredSpec());
  for (const price of [6, 7]) {
    recordFailure(run, 'product', `Price case ${price}`);
    repair(run, price);
  }
  recordFailure(run, 'product', 'Outstanding rubric finding');
  const finding = { id: 'price-path', rule: 'conformance', evidence: 'The negative-price branch returns an invalid value.' };
  upsertFinding(run, { ...finding, disposition: 'open' });
  upsertFinding(run, { ...finding, disposition: 'fixed', resolution: 'Corrected the negative-price branch.' });
  assert.equal(recoveryStatus(run).pause, undefined);
  upsertFinding(run, { ...finding, disposition: 'open' });
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
  upsertFinding(run, { ...finding, disposition: 'fixed', resolution: 'Corrected a second negative-price branch.' });
  assert.equal(run.recoveryControl!.progress.length, 1);
  assert.ok(run.recoveryControl!.progress[0]!.revokedAt);
  assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
  writeRun(run);
  assert.equal(recoveryStatus(readRun(project)).pause?.kind, 'stagnation');
});

for (const maxCorrections of [undefined, 6]) test(`AUTO continues past three real corrections with ${maxCorrections ?? 'no'} correction ceiling`, async context => {
  const project = fixture(context);
  const specification = measuredSpec();
  specification.recovery = { mode: 'auto', ...(maxCorrections === undefined ? {} : { maxCorrections }) };
  approved(project, specification);
  await executeCheck(project, 'unit');
  let run = readRun(project);
  for (let correction = 1; correction <= 6; correction += 1) {
    if (recoveryStatus(run).pause?.kind === 'stagnation') {
      assert.throws(() => retry(run, 'Blind retry without diagnosis', false), /diagnosis|strategy/i);
      diagnose(run, `The output after correction ${correction - 1} exposes another calculation branch`);
    }
    repair(run, 10 + correction);
    await executeCheck(project, 'unit');
    run = readRun(project);
    assert.equal(run.blocks[0]!.rounds.length, correction);
    assert.equal(run.version, 4);
    assert.equal(run.readerMinimumVersion, 4);
  }
  assert.equal(run.recoveryControl!.strategies.length, 2);
  assert.equal(run.recoveryControl!.progress.length, 0);
  if (maxCorrections === undefined) {
    assert.equal(recoveryStatus(run).pause?.kind, 'stagnation');
    diagnose(run, 'The sixth correction exposed the final calculation branch');
    repair(run, 0);
    assert.equal((await executeCheck(project, 'unit')).status, 'pass');
    run = readRun(project);
    assert.equal(run.blocks[0]!.rounds.length, 7);
  } else {
    assert.equal(recoveryStatus(run).pause?.kind, 'budget');
    assert.throws(() => retry(run, 'Beyond the authorized ceiling', false), /budget/i);
  }
  promoteRecoveryRecord(run, 3);
  assert.equal(run.version, 4);
  assert.equal(run.readerMinimumVersion, 4);
});

test('unadopted legacy recovery still stops at three real corrections', context => {
  const project = fixture(context);
  const run = approved(project);
  for (let correction = 1; correction <= 3; correction += 1) {
    recordFailure(run, 'product', `Legacy price failure ${correction}`);
    if (correction === 3) diagnose(run, 'The first two legacy repairs missed a price branch');
    repair(run, 10 + correction);
  }
  recordFailure(run, 'product', 'Fourth legacy failure');
  assert.equal(recoveryStatus(run).pause?.kind, 'budget');
  assert.throws(() => retry(run, 'Fourth legacy correction', false), /budget/i);
  assert.equal(run.version, 3);
  assert.equal(readRun(project).version, 3);
});

test('AUTO metric credit requires a new best result and rejects replay or metric renaming', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  approved(project, measuredSpec());
  const ten = await executeCheck(project, 'unit');
  let run = readRun(project);
  repair(run, 8);
  const eight = await executeCheck(project, 'unit');
  run = readRun(project);
  diagnose(run, 'Measured improvement to eight', measurement(ten, eight));
  recordFailure(run, 'product', 'Eight failures remain', eight.attempt);
  diagnose(run, 'Measured improvement to eight');
  recordFailure(run, 'product', 'Replay must not receive another credit', eight.attempt);
  assert.throws(() => diagnose(run, 'Replay of the prior measurement', measurement(ten, eight)), /credited again/i);
  repair(run, 12);
  const twelve = await executeCheck(project, 'unit');
  run = readRun(project);
  assert.throws(() => diagnose(run, 'Measured improvement to eight'), /changed principal diagnosis/i);
  repair(run, 10);
  const regressedTen = await executeCheck(project, 'unit');
  run = readRun(project);
  assert.throws(() => diagnose(run, 'Rename the established metric', { ...measurement(twelve, regressedTen), metric: 'new-failure-label' }), /preserve the established check metric/i);
  diagnose(run, 'Local reduction to ten', measurement(twelve, regressedTen));
  recordFailure(run, 'product', 'Ten remains worse than the best eight', regressedTen.attempt);
  assert.throws(() => diagnose(run, 'Local reduction to ten'), /changed principal diagnosis/i);
  repair(run, 14);
  const fourteen = await executeCheck(project, 'unit');
  run = readRun(project);
  repair(run, 12);
  const regressedTwelve = await executeCheck(project, 'unit');
  run = readRun(project);
  diagnose(run, 'Local reduction to twelve', measurement(fourteen, regressedTwelve));
  recordFailure(run, 'product', 'Twelve also remains worse than eight', regressedTwelve.attempt);
  assert.throws(() => diagnose(run, 'Local reduction to twelve'), /changed principal diagnosis/i);
  repair(run, 7);
  const seven = await executeCheck(project, 'unit');
  run = readRun(project);
  diagnose(run, 'New best result of seven', measurement(regressedTwelve, seven));
  recordFailure(run, 'product', 'Seven failures remain', seven.attempt);
  diagnose(run, 'New best result of seven');
});

test('AUTO rejects unrelated metric logs and revalidates stored numeric and log evidence', async context => {
  const project = fixture(context);
  const specification = measuredSpec();
  specification.checks.push({ ...specification.checks[0]!, id: 'other' });
  specification.blocks[0]!.checks.push('other');
  approved(project, specification);
  const before = await executeCheck(project, 'unit');
  let run = readRun(project);
  repair(run, 4);
  const after = await executeCheck(project, 'unit');
  run = readRun(project);
  diagnose(run, 'A measured reduction to four', measurement(before, after));
  repair(run, 3);
  const unrelated = await executeCheck(project, 'other');
  run = readRun(project);
  assert.throws(() => diagnose(run, 'Unrelated check metric', measurement(before, after)), /implicated/i);
  assert.throws(() => diagnose(run, 'Different before and after checks', measurement(after, unrelated)), /same completed check/i);
  const stored = run.recoveryControl!.strategies[0]!.progress!;
  stored.after = stored.before;
  assert.throws(() => recoveryStatus(run), /nonnegative reduction/i);
  stored.after = 4;
  writeFileSync(after.log, `${readFileSync(after.log, 'utf8')}tampered\n`);
  assert.throws(() => recoveryStatus(run), /intact chronological/i);
});
