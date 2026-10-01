import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { activateBlock, authorize, startRun } from '../src/lifecycle.ts';
import { parkRun, startFromParkedRun } from '../src/parking.ts';
import { digest } from '../src/project.ts';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { adoptRecoveryPolicy, recoveryBudget, authorizeRecovery } from '../src/recovery-policy.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { parseSpec } from '../src/schema.ts';
import { pendingMemory, queueMemory } from '../src/memory.ts';
import { readRun, selectRun, stateDirectory, writeRun } from '../src/store.ts';
import { fixture, spec } from './support.ts';

test('a native recovery policy creates a version 3 durable owner', context => {
  const project = fixture(context);
  const specification = spec('recovery-owner');
  specification.recovery = { maxCorrections: 4 };
  const run = startRun(project, specification);
  assert.equal(run.version, 3);
  assert.equal(run.readerMinimumVersion, 3);
  assert.deepEqual(run.recovery, { owner: run.spec.id, specDigest: run.specDigest, initialLimit: 4, grants: [] });
});

test('a roadmap recovery budget counts root and nested child corrections together', context => {
  const project = fixture(context);
  const roadmap = spec('recovery-roadmap');
  const child = spec('recovery-child');
  const nested = spec('recovery-nested');
  child.mode = 'roadmap';
  child.children = [nested];
  roadmap.mode = 'roadmap';
  roadmap.recovery = { maxCorrections: 4 };
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  spend(root, project, 1);
  writeRun(root);
  const first = startRoadmapChild(project, root, child);
  spend(first, project, 2);
  writeRun(first);
  const second = startRoadmapChild(project, first, nested);
  root.spec.objective = 'Amended roadmap objective';
  root.specDigest = digest(JSON.stringify(root.spec));
  first.spec.objective = 'Amended intermediate roadmap objective';
  first.specDigest = digest(JSON.stringify(first.spec));
  writeRun(root);
  writeRun(first);
  spend(second, project, 1);
  assert.equal(recoveryBudget(second).used, 4);
  recordFailure(second, 'product', 'fifth correction');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 9;\n');
  assert.throws(() => retry(second, 'Corrected nested fixture', false), /limit/i);
  assert.equal(second.status, 'running');
  assert.equal(second.blocks[0]!.failure?.cause, 'fifth correction');
});

test('a separately authorized parked successor owns a separate recovery budget', context => {
  const project = fixture(context);
  const original = spec('recovery-original');
  original.recovery = { maxCorrections: 1 };
  const run = authorized(project, original);
  parkRun(run, 'Switch to separately authorized documentation work');
  writeRun(run);
  const successor = spec('recovery-successor');
  successor.recovery = { maxCorrections: 2 };
  const next = startFromParkedRun(project, run, successor);
  assert.equal(recoveryBudget(next).owner, successor.id);
  assert.equal(recoveryBudget(next).used, 0);
  assert.equal(recoveryBudget(run).remaining, 1);
});

test('recovery authorization is idempotent, stale-safe, and preserves existing evidence', context => {
  const project = fixture(context);
  const specification = spec('recovery-grant');
  specification.recovery = { maxCorrections: 1 };
  const run = authorized(project, specification);
  recordFailure(run, 'product', 'preserved failure');
  const before = recoveryBudget(run);
  const input = authorization(before, 2, 'turn:2026/09/14');
  const owner = authorizeRecovery(run, input);
  assert.equal(owner.recovery!.grants!.length, 1);
  assert.equal(owner.blocks[0]!.failure?.cause, 'preserved failure');
  writeRun(owner);
  assert.equal(readRun(project).recovery!.grants![0]!.authorization.reference, 'turn:2026/09/14');
  assert.equal(authorizeRecovery(run, input).recovery!.grants!.length, 1);
  assert.throws(() => authorizeRecovery(run, { ...input, authorization: { ...input.authorization, message: 'Changed message' } }), /already used/i);
  assert.throws(() => authorizeRecovery(run, { ...authorization(recoveryBudget(run), 1, 'grant-2'), revision: before.revision }), /stale/i);
  assert.throws(() => authorizeRecovery(run, { ...authorization(recoveryBudget(run), 1, 'grant-3'), owner: 'wrong-owner' }), /owner/i);
  assert.throws(() => authorizeRecovery(run, { ...authorization(recoveryBudget(run), 1, 'grant-4'), specDigest: '0'.repeat(64) }), /specification/i);
});

test('a recovery strategy changes the authorization revision', context => {
  const project = fixture(context);
  const specification = spec('strategy-revision');
  specification.recovery = { maxCorrections: 4 };
  const run = authorized(project, specification);
  spend(run, project, 2);
  recordFailure(run, 'product', 'strategy-bound failure');
  const before = recoveryBudget(run);
  const stale = authorization(before, 1, 'strategy-stale-grant');
  recordRecoveryStrategy(run, { block: 'price', failureKey: recoveryStatus(run).failureKey!, diagnosis: { agent: run.spec.principal, report: 'Two corrections did not resolve the recorded failing behavior.', evidence: ['recorded checks', 'current failure'] }, approach: 'Revise the calculation and execute the affected check.' });
  assert.notEqual(recoveryBudget(run).revision, before.revision);
  assert.throws(() => authorizeRecovery(run, stale), /stale/i);
});

test('AUTO adoption ignores retained legacy grant arithmetic and replays semantic policy objects', context => {
  const project = fixture(context);
  const run = authorized(project, spec('auto-adoption-history'));
  const before = recoveryBudget(run);
  const adoption = {
    owner: before.owner,
    specDigest: before.specDigest,
    revision: before.revision,
    policy: { mode: 'auto' as const, maxCorrections: 7 },
    authorization: { kind: 'user' as const, reference: 'fixture/auto-adoption', message: 'Adopt unbounded AUTO for the retained correction history', specDigest: before.specDigest },
  };
  const owner = adoptRecoveryPolicy(run, adoption);
  owner.recovery!.grants = [
    { additionalCorrections: Number.MAX_SAFE_INTEGER, authorization: { kind: 'user', reference: 'fixture/old-grant-1', message: 'Historical grant one', specDigest: before.specDigest } },
    { additionalCorrections: 1, authorization: { kind: 'user', reference: 'fixture/old-grant-2', message: 'Historical grant two', specDigest: before.specDigest } },
  ];
  assert.equal(recoveryBudget(owner).limit, 7);
  const events = owner.events.length;
  const replay = adoptRecoveryPolicy(owner, {
    ...adoption,
    policy: { maxCorrections: 7, mode: 'auto' },
  });
  assert.equal(replay, owner);
  assert.equal(owner.events.length, events);
});

test('a child AUTO declaration cannot bypass the root roadmap recovery authority', context => {
  const project = fixture(context);
  const roadmap = spec('root-recovery-authority');
  const child = spec('child-auto-policy');
  child.recovery = { mode: 'auto' };
  roadmap.mode = 'roadmap';
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  writeRun(root);
  const inherited = startRoadmapChild(project, root, child);
  assert.equal(inherited.recovery, undefined);
  assert.equal(recoveryBudget(inherited).owner, root.spec.id);
  assert.equal(recoveryBudget(inherited).policy, undefined);
  const before = recoveryBudget(inherited);
  const owner = adoptRecoveryPolicy(inherited, {
    owner: before.owner,
    specDigest: before.specDigest,
    revision: before.revision,
    policy: { mode: 'auto' },
    authorization: { kind: 'user', reference: 'fixture/root-auto-adoption', message: 'Authorize AUTO at the roadmap root for its inherited child', specDigest: before.specDigest },
  });
  assert.equal(owner.spec.id, root.spec.id);
  assert.equal(owner.recovery!.policySource, 'adoption');
});

test('a finite child retains its legacy recovery ownership when the root has no durable policy', context => {
  const project = fixture(context);
  const roadmap = spec('legacy-unbounded-root');
  const child = spec('legacy-finite-child');
  child.recovery = { maxCorrections: 2 };
  roadmap.mode = 'roadmap';
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  writeRun(root);
  const owned = startRoadmapChild(project, root, child);
  assert.equal(owned.version, 3);
  assert.equal(owned.readerMinimumVersion, 3);
  assert.deepEqual(owned.recovery, { owner: child.id, specDigest: owned.specDigest, initialLimit: 2, grants: [] });
  spend(owned, project, 1);
  writeRun(owned);
  const persisted = readRun(project);
  assert.equal(recoveryBudget(persisted).owner, child.id);
  assert.equal(recoveryBudget(persisted).remaining, 1);
  assert.equal(readRun(project, root.spec.id).version, 1);
});

test('AUTO grandchildren retain the root owner and require the version 4 reader', context => {
  const project = fixture(context);
  const roadmap = spec('auto-root');
  const child = spec('auto-child');
  const nested = spec('auto-grandchild');
  child.mode = 'roadmap';
  child.children = [nested];
  roadmap.mode = 'roadmap';
  roadmap.recovery = { mode: 'auto', maxCorrections: 6 };
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  writeRun(root);
  const first = startRoadmapChild(project, root, child);
  assert.equal(first.recovery!.policy, undefined);
  const second = startRoadmapChild(project, first, nested);
  assert.equal(second.version, 4);
  assert.equal(second.readerMinimumVersion, 4);
  assert.deepEqual(second.recovery, { owner: root.spec.id, specDigest: root.specDigest });
  assert.equal(readRun(project).version, 4);
  assert.equal(recoveryBudget(second).owner, root.spec.id);
  assert.equal(recoveryBudget(second).limit, 6);
});

test('root AUTO adoption preserves a finite child owner and its binding correction limit', context => {
  const project = fixture(context);
  const roadmap = spec('adopting-auto-root');
  const child = spec('retained-finite-child');
  child.recovery = { maxCorrections: 2 };
  roadmap.mode = 'roadmap';
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  writeRun(root);
  const owned = startRoadmapChild(project, root, child);
  spend(owned, project, 2);
  writeRun(owned);
  const childRecovery = structuredClone(owned.recovery);
  const before = recoveryBudget(root);
  adoptRecoveryPolicy(root, {
    owner: before.owner,
    specDigest: before.specDigest,
    revision: before.revision,
    policy: { mode: 'auto' },
    authorization: { kind: 'user', reference: 'fixture/root-adoption-retains-child', message: 'Adopt AUTO for the root without changing the finite child owner', specDigest: before.specDigest },
  });
  writeRun(root);
  const retained = readRun(project, owned.spec.id);
  assert.deepEqual(retained.recovery, childRecovery);
  assert.equal(retained.version, 3);
  assert.equal(recoveryBudget(retained).owner, child.id);
  assert.equal(recoveryBudget(retained).remaining, 0);
  recordFailure(retained, 'product', 'finite child remains exhausted');
  assert.throws(() => retry(retained, 'Root AUTO adoption does not release this finite child limit', false), /limit/i);
});

test('a nested child cannot activate an ignored parent AUTO declaration', context => {
  const project = fixture(context);
  const roadmap = spec('legacy-root-authority');
  const child = spec('ignored-auto-parent');
  const nested = spec('ignored-auto-grandchild');
  child.mode = 'roadmap';
  child.recovery = { mode: 'auto' };
  child.children = [nested];
  roadmap.mode = 'roadmap';
  roadmap.children = [child];
  const root = authorized(project, roadmap);
  writeRun(root);
  const first = startRoadmapChild(project, root, child);
  const second = startRoadmapChild(project, first, nested);
  assert.equal(recoveryBudget(second).owner, root.spec.id);
  assert.equal(recoveryBudget(second).policy, undefined);
});

test('a legacy run adopts historical corrections once before its first grant', context => {
  const project = fixture(context);
  const run = authorized(project, spec('legacy-recovery'));
  spend(run, project, 1);
  const before = recoveryBudget(run);
  assert.equal(before.limit, undefined);
  assert.equal(before.used, 1);
  const owner = authorizeRecovery(run, authorization(before, 4, 'legacy-grant'));
  assert.equal(owner.version, 3);
  assert.equal(owner.recovery!.adoptedUsed, 1);
  const after = recoveryBudget(owner);
  assert.equal(after.limit, 5);
  assert.equal(after.used, 1);
  assert.equal(after.remaining, 4);
});

test('a grant invalidates its owner memory position once and rejects a foreign persisted authority', context => {
  const project = fixture(context);
  const run = authorized(project, spec('grant-memory'));
  writeRun(run);
  const position = pendingMemory(project).position;
  queueMemory(project, { project: 'fixture', topic: 'oso/grant-memory/plan', content: 'No additional corrections authorized', error: 'Synthetic outage', position });
  const input = authorization(recoveryBudget(run), 2, 'session/2026-09-15T00:00:00Z');
  authorizeRecovery(run, input);
  writeRun(run);
  assert.equal(pendingMemory(project).entries[0]!.stale, true);
  const events = run.events.length;
  authorizeRecovery(run, input);
  assert.equal(run.events.length, events);
  const malformed = structuredClone(run);
  malformed.recovery!.grants![0]!.authorization.specDigest = '0'.repeat(64);
  writeFileSync(path.join(stateDirectory(project), 'runs', `${run.spec.id}.json`), JSON.stringify(malformed));
  assert.throws(() => readRun(project), /grant is malformed/);
});

test('a legacy child adopts its root budget and siblings retain shared historical use', context => {
  const project = fixture(context);
  const roadmap = spec('legacy-roadmap');
  const first = spec('legacy-first');
  const sibling = spec('legacy-sibling');
  roadmap.mode = 'roadmap';
  roadmap.children = [first, sibling];
  const root = authorized(project, roadmap);
  spend(root, project, 1);
  writeRun(root);
  const child = startRoadmapChild(project, root, first);
  spend(child, project, 1);
  writeRun(child);
  const before = recoveryBudget(child);
  assert.equal(before.owner, root.spec.id);
  assert.equal(before.used, 2);
  const owner = authorizeRecovery(child, authorization(before, 2, 'legacy-family-grant'));
  writeRun(owner);
  parkRun(child, 'Preserve the first child while exercising its approved sibling budget');
  writeRun(child);
  const next = startRoadmapChild(project, owner, sibling);
  spend(next, project, 1);
  writeRun(next);
  assert.equal(recoveryBudget(readRun(project, first.id)).remaining, 1);
  assert.equal(recoveryBudget(readRun(project, root.spec.id)).used, 3);
});

test('schema accepts only positive safe recovery correction limits', () => {
  const valid = spec('policy-schema');
  valid.recovery = { maxCorrections: 1 };
  assert.equal(parseSpec(valid).recovery!.maxCorrections, 1);
  const auto = spec('auto-policy-schema');
  auto.recovery = { mode: 'auto' };
  assert.deepEqual(parseSpec(auto).recovery, { mode: 'auto' });
  for (const maxCorrections of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = spec(`policy-${Math.abs(maxCorrections).toString().replace('.', '-')}`);
    invalid.recovery = { maxCorrections };
    assert.throws(() => parseSpec(invalid), /positive safe integer/i);
  }
});

test('reader rejects malformed or newer recovery state without migration', context => {
  const project = fixture(context);
  const specification = spec('invalid-recovery-state');
  specification.recovery = { maxCorrections: 2 };
  const run = startRun(project, specification);
  writeRun(run);
  const filename = path.join(stateDirectory(project), 'runs', `${run.spec.id}.json`);
  const malformed = JSON.parse(readFileSync(filename, 'utf8')) as { recovery: { initialLimit: number } };
  malformed.recovery.initialLimit = 0;
  writeFileSync(filename, JSON.stringify(malformed));
  assert.throws(() => readRun(project), /malformed/i);
  const newer = JSON.parse(readFileSync(filename, 'utf8')) as { recovery: { initialLimit: number }; readerMinimumVersion: number };
  newer.recovery.initialLimit = 2;
  newer.readerMinimumVersion = 5;
  writeFileSync(filename, JSON.stringify(newer));
  assert.throws(() => readRun(project), /requires runtime reader version 5/i);
});

test('version 4 reader rejects malformed AUTO policies and mismatched specification sources', context => {
  const project = fixture(context);
  const specification = spec('malformed-auto-owner');
  specification.recovery = { mode: 'auto', maxCorrections: 2 };
  const run = startRun(project, specification);
  const filename = path.join(stateDirectory(project), 'runs', `${run.spec.id}.json`);
  const malformedStates = [
    { ...run.recovery, policy: { mode: 'auto', maxCorrections: 0 } },
    { ...run.recovery, policy: { mode: 'auto', maxCorrections: 1.5 } },
    { ...run.recovery, policy: { mode: 'auto', maxCorrections: Number.MAX_SAFE_INTEGER + 1 } },
    { ...run.recovery, policy: { mode: 'auto', retries: 2 } },
    { ...run.recovery, policy: { mode: 'manual' } },
    { ...run.recovery, policy: undefined },
    { ...run.recovery, policySource: undefined },
    { ...run.recovery, adoptions: undefined },
    { ...run.recovery, policy: { mode: 'auto', maxCorrections: 3 } },
    { ...run.recovery, policySource: 'adoption' },
  ];
  for (const recovery of malformedStates) {
    const contents = JSON.stringify({ ...run, recovery });
    writeFileSync(filename, contents);
    assert.throws(() => readRun(project), /malformed|declared source/i);
    assert.equal(readFileSync(filename, 'utf8'), contents);
  }
});

test('version 4 reader binds the effective AUTO policy to the latest adoption', context => {
  const project = fixture(context);
  const run = authorized(project, spec('adoption-source'));
  const before = recoveryBudget(run);
  adoptRecoveryPolicy(run, {
    owner: before.owner,
    specDigest: before.specDigest,
    revision: before.revision,
    policy: { mode: 'auto', maxCorrections: 4 },
    authorization: { kind: 'user', reference: 'fixture/adoption-source', message: 'Authorize four total corrections in AUTO', specDigest: before.specDigest },
  });
  writeRun(run);
  assert.equal(readRun(project).recovery!.policy!.maxCorrections, 4);
  const filename = path.join(stateDirectory(project), 'runs', `${run.spec.id}.json`);
  const adoption = run.recovery!.adoptions![0]!;
  const malformedStates = [
    { ...run.recovery, policy: { mode: 'auto' } },
    { ...run.recovery, policySource: 'spec' },
    { ...run.recovery, adoptions: [{ ...adoption, policy: { mode: 'auto', maxCorrections: -1 } }] },
    { ...run.recovery, adoptions: [{ ...adoption, authorization: { ...adoption.authorization, specDigest: '0'.repeat(64) } }] },
    { ...run.recovery, adoptions: [{ ...adoption, at: 'not-a-timestamp' }] },
  ];
  for (const recovery of malformedStates) {
    writeFileSync(filename, JSON.stringify({ ...run, recovery }));
    assert.throws(() => readRun(project), /malformed|declared source/i);
  }
});

test('version 4 can retain a legacy finite owner without inventing an AUTO policy', context => {
  const project = fixture(context);
  const specification = spec('v4-legacy-finite');
  specification.recovery = { maxCorrections: 2 };
  const run = authorized(project, specification);
  run.version = 4;
  run.readerMinimumVersion = 4;
  writeRun(run);
  const persisted = readRun(project);
  assert.equal(recoveryBudget(persisted).policy, undefined);
  spend(persisted, project, 1);
  writeRun(persisted);
  assert.equal(readRun(project).version, 4);
  assert.equal(recoveryBudget(persisted).remaining, 1);
});

test('retry events distinguish unlimited AUTO, explicit ceilings, and legacy rounds', context => {
  for (const [id, recovery, detail] of [
    ['unlimited-auto-event', { mode: 'auto' }, '1 (auto):'],
    ['capped-auto-event', { mode: 'auto', maxCorrections: 4 }, '1/4:'],
    ['finite-event', { maxCorrections: 2 }, '1/2:'],
    ['legacy-event', undefined, '1/3:'],
  ] as const) {
    const project = fixture(context);
    const specification = spec(id);
    specification.recovery = recovery;
    const run = authorized(project, specification);
    spend(run, project, 1);
    assert.ok(run.events.find(entry => entry.action === 'retry')!.detail.startsWith(detail));
  }
});

test('a legacy policy upgrades its record to version 3 with its first correction debit', context => {
  const project = fixture(context);
  const specification = spec('legacy-policy-debit');
  specification.recovery = { maxCorrections: 2 };
  const original = authorized(project, specification);
  original.version = 1;
  delete original.readerMinimumVersion;
  delete original.recovery;
  writeRun(original);
  const run = readRun(project);
  recordFailure(run, 'product', 'upgrade during correction');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 20;\n');
  retry(run, 'Corrected legacy policy fixture', false);
  assert.equal(run.version, 3);
  assert.equal(run.readerMinimumVersion, 3);
  assert.equal(run.recovery!.initialLimit, 2);
  assert.equal(run.blocks[0]!.rounds.length, 1);
  writeRun(run);
  assert.equal(readRun(project).version, 3);
});

test('a recovery grant cannot overflow or authorize a pending plan', context => {
  const project = fixture(context);
  const specification = spec('overflow-recovery');
  specification.recovery = { maxCorrections: 1 };
  const run = authorized(project, specification);
  authorizeRecovery(run, authorization(recoveryBudget(run), Number.MAX_SAFE_INTEGER - 1, 'first-overflow-grant'));
  const prior = structuredClone(run.recovery);
  assert.throws(() => authorizeRecovery(run, authorization(recoveryBudget(run), 1, 'overflow-grant')), /largest safe/i);
  assert.deepEqual(run.recovery, prior);
  const pendingProject = fixture(context);
  const pendingSpec = spec('pending-recovery');
  pendingSpec.recovery = { maxCorrections: 1 };
  const pending = startRun(pendingProject, pendingSpec, { deferSelection: true });
  assert.throws(() => authorizeRecovery(pending, authorization(recoveryBudget(pending), 1, 'pending-grant')), /Execution requires/i);
});

function authorized(project: string, specification: ReturnType<typeof spec>) {
  const run = startRun(project, specification);
  authorize(run, { kind: 'user', reference: `${specification.id}-approval`, message: 'Approved fixture work', specDigest: run.specDigest });
  activateBlock(run, specification.blocks[0]!.id);
  return run;
}

function startRoadmapChild(project: string, parent: ReturnType<typeof startRun>, specification: ReturnType<typeof spec>) {
  const child = startRun(project, specification, { deferSelection: true, roadmapParent: parent.spec.id });
  authorize(child, { kind: 'roadmap', parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id });
  activateBlock(child, child.blocks[0]!.id);
  child.version = recoveryBudget(child).policy ? 4 : child.recovery ? 3 : 2;
  child.readerMinimumVersion = child.version;
  delete child.roadmapLineage;
  writeRun(child);
  selectRun(child);
  return child;
}

function spend(run: ReturnType<typeof startRun>, project: string, corrections: number): void {
  for (let index = 0; index < corrections; index += 1) {
    recordFailure(run, 'product', `fixture failure ${index}`);
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${index + 10};\nexport const correction = '${run.spec.id}-${index}';\n`);
    retry(run, `Corrected fixture ${index}`, false);
  }
}

function authorization(budget: ReturnType<typeof recoveryBudget>, additionalCorrections: number, reference: string) {
  return { owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, additionalCorrections, authorization: { kind: 'user' as const, reference, message: `Approved ${additionalCorrections} additional corrections`, specDigest: budget.specDigest } };
}
