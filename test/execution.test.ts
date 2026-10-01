import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classifyOutput, executeCheck, validCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { activateBlock, authorize, importLegacy, startRun } from '../src/lifecycle.ts';
import { checkFingerprint, digest, scopeMatches } from '../src/project.ts';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { confirmStoppedCheck, recordFailure, reconcile, retry } from '../src/recovery.ts';
import { closeBlock, closeRun, finishAgent, recordContribution, recordObservation, recordReview, registerAgent, upsertFinding } from '../src/reviews.ts';
import { parseSpec } from '../src/schema.ts';
import { processIdentity, readRun, writeRun } from '../src/store.ts';
import { approved, fixture, reviewed, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('execution requires authorization bound to the exact specification', context => {
  const run = startRun(fixture(context), spec());
  assert.throws(() => activateBlock(run, 'price'), /authorization/);
  assert.throws(() => authorize(run, { kind: 'user', reference: 'turn', message: 'Go', specDigest: 'different' }), /digest/);
  authorize(run, { kind: 'user', reference: 'turn', message: 'Implement this plan', specDigest: run.specDigest });
  run.spec.objective = 'Unapproved objective';
  assert.throws(() => activateBlock(run, 'price'), /changed/);
});

test('schema rejects missing rubric, unknown checks, cycles and escaping paths', () => {
  const missing = spec();
  missing.blocks[0]!.criteria = ['price'];
  assert.throws(() => parseSpec(missing), /rubric/);
  const paths = spec();
  paths.checks[0]!.inputs = ['../secret'];
  assert.throws(() => parseSpec(paths), /relative/);
  const cycle = spec();
  cycle.blocks[0]!.dependsOn = ['price'];
  assert.throws(() => parseSpec(cycle), /precede/);
  assert.deepEqual(parseSpec(spec()), spec());
});

test('roadmap run ids are unique across parents, siblings and nested cousins', () => {
  const parent = spec('roadmap');
  parent.mode = 'roadmap';
  parent.children = [spec('roadmap')];
  assert.throws(() => parseSpec(parent), /Duplicate id/);
  const nested = spec('nested');
  nested.mode = 'roadmap';
  nested.children = [spec('reused')];
  parent.children = [nested, spec('reused')];
  assert.throws(() => parseSpec(parent), /Duplicate id/);
});

test('one approved roadmap authorizes exact children without fabricated user approvals', context => {
  const project = fixture(context);
  const parentSpec = spec('roadmap');
  parentSpec.mode = 'roadmap';
  parentSpec.children = [spec('child')];
  const parent = approved(project, parentSpec);
  const child = startRun(project, parentSpec.children[0]!);
  authorize(child, { kind: 'roadmap', parentRun: 'roadmap', parentDigest: parent.specDigest, child: 'child' });
  assert.equal(child.approval!.kind, 'roadmap');
  child.spec.objective = 'More than approved';
  assert.throws(() => activateBlock(child, 'price'), /changed/);
});

test('a blocked run cannot be replaced with a fresh run to reset its budget', context => {
  const project = fixture(context);
  approved(project);
  assert.throws(() => startRun(project, spec('replacement')), /active/);
  assert.throws(() => startRun(project, spec()), /already exists/);
});

test('exact authorized roadmap relatives share current checks while unrelated runs cannot', async context => {
  const project = fixture(context);
  const parentSpec = spec('roadmap');
  parentSpec.mode = 'roadmap';
  parentSpec.children = [spec('child')];
  const parent = approved(project, parentSpec);
  const child = startRun(project, parentSpec.children[0]!);
  authorize(child, { kind: 'roadmap', parentRun: 'roadmap', parentDigest: parent.specDigest, child: 'child' });
  activateBlock(child, 'price');
  writeRun(child);
  const result = await executeCheck(project, 'unit');
  assert.equal(validCheck(readRun(project, 'roadmap'), 'unit')!.attempt, result.attempt);
  assert.equal(readRun(project, 'roadmap').checks.length, 0);
  const changed = readRun(project, 'child');
  changed.approval = { kind: 'user', message: 'Separate scope', reference: 'separate-turn', specDigest: changed.specDigest };
  writeRun(changed);
  assert.equal(validCheck(parent, 'unit'), undefined);
  writeRun(readRun(project, 'roadmap'));
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  assert.equal(validCheck(changed, 'unit'), undefined);
});

test('recorded command evidence is reused until relevant inputs change', async context => {
  const project = fixture(context);
  approved(project);
  const first = await executeCheck(project, 'unit');
  assert.equal(first.status, 'pass');
  writeFileSync(path.join(project, 'README.md'), 'Documentation change\n');
  const second = await executeCheck(project, 'unit');
  assert.equal(second.attempt, first.attempt);
  assert.equal(second.reused, true);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  const third = await executeCheck(project, 'unit');
  assert.notEqual(third.attempt, first.attempt);
  assert.equal(readRun(project).checks.length, 2);
});

test('environment and configuration changes invalidate only checks that depend on them', context => {
  const project = fixture(context);
  const check = spec().checks[0]!;
  check.inputs.push('build.json');
  check.envKeys = ['OSO_CODEX_FIXTURE_ENV'];
  const first = checkFingerprint(project, check);
  writeFileSync(path.join(project, 'build.json'), '{"target":"new"}');
  const configured = checkFingerprint(project, check);
  assert.notEqual(first, configured);
  process.env.OSO_CODEX_FIXTURE_ENV = 'changed';
  try { assert.notEqual(configured, checkFingerprint(project, check)); } finally { delete process.env.OSO_CODEX_FIXTURE_ENV; }
});

test('notice and update output passes; actual warnings and failures do not', () => {
  assert.equal(classifyOutput('NOTICE: legacy database notice\nnpm notice update available\nINFO: complete\n0 warnings', { code: 0 }).status, 'pass');
  assert.equal(classifyOutput('Warning: unused export', { code: 0 }).status, 'fail');
  assert.equal(classifyOutput('AssertionError: price is wrong', { code: 1 }).status, 'fail');
  assert.equal(classifyOutput('EACCES: permission denied', { code: 1 }).status, 'blocked');
  assert.equal(classifyOutput('', { code: null, timeout: true }).status, 'blocked');
});

test('missing executables produce one infrastructure episode without an automatic retry', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.checks[0]!.command = ['oso-code-codex-intentionally-missing'];
  approved(project, specification);
  assert.equal((await executeCheck(project, 'unit')).status, 'blocked');
  await assert.rejects(executeCheck(project, 'unit'), /infrastructure/);
  assert.equal(readRun(project).checks.length, 1);
});

test('an expected red reproduction preserves failing evidence without consuming a correction round', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, '-e', 'process.exit(1)'];
  approved(project, specification);
  const result = await executeCheck(project, 'unit', true);
  const run = readRun(project);
  assert.equal(result.status, 'reproduced');
  assert.equal(result.exitCode, 1);
  assert.equal(validCheck(run, 'unit'), undefined);
  assert.equal(run.blocks[0]!.failure, undefined);
  assert.equal(run.blocks[0]!.rounds.length, 0);
  await assert.rejects(executeCheck(project, 'unit', true), /first observation/);
  await executeCheck(project, 'unit');
  assert.equal(readRun(project).blocks[0]!.failure!.kind, 'product');
});

test('independent review accepts normal prose without exact report labels', async context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run, 'Revisé el cambio completo. Precio, claridad y decisiones coinciden. Los resultados registrados son suficientes.');
  closeBlock(run);
  closeRun(run);
  assert.equal(run.status, 'closed');
  assert.equal(run.checks.length, 1);
});

test('author self-review, stale evidence, missing criteria and log tampering cannot close', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  assert.throws(() => registerAgent(run, { id: run.spec.principal, role: 'reviewer', tier: 'luna', scope: ['app.mjs'] }), /native child/);
  registerAgent(run, { id: 'reviewer', role: 'reviewer', tier: 'luna', scope: ['app.mjs'] });
  finishAgent(run, 'reviewer', 'The result looks good');
  assert.throws(() => recordReview(run, { agent: 'reviewer', kind: 'general', verdict: 'pass', criteria: ['price'] }), /missing required/);
  reviewed(run);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 9;');
  assert.throws(() => closeBlock(run), /current independent review/);
  writeFileSync(run.checks[0]!.log, 'Forged successful result');
  assert.equal(validCheck(run, 'unit'), undefined);
});

test('all real rubric findings prevent closure regardless of severity or formatting', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  for (const rule of ['secret', 'swallowed-error', 'speculative-abstraction', 'inline-comment', 'duplication', 'dead-code']) {
    upsertFinding(run, { id: rule, rule, evidence: `app.mjs:1 violates ${rule}`, disposition: 'open' });
    assert.throws(() => closeBlock(run), /Unresolved/);
    upsertFinding(run, { id: rule, rule, evidence: `app.mjs:1`, disposition: 'false-positive', resolution: 'Fixture report claimed a token but this file contains only a numeric export; code disproves the finding.' });
  }
  closeBlock(run);
});

test('recovery budgets survive resumes, changed labels and native agent replacement', context => {
  const project = fixture(context);
  let run = approved(project);
  for (let round = 0; round < 3; round++) {
    recordFailure(run, round === 1 ? 'delivery' : 'product', `failure ${round}`);
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${round + 7};`);
    if (round === 2) {
      recordRecoveryStrategy(run, { block: 'price', failureKey: recoveryStatus(run).failureKey!, diagnosis: { agent: run.spec.principal, report: 'The earlier corrections did not resolve the observed fixture failure.', evidence: ['recorded failure', 'updated fixture'] }, approach: 'Apply the next measured correction and rerun the affected unit check.' });
    }
    retry(run, `Corrected fixture ${round}`, round === 2);
    writeRun(run);
    run = readRun(project);
    reconcile(run);
  }
  recordFailure(run, 'infrastructure', 'fourth episode');
  assert.throws(() => retry(run, 'Try again', true, 'Environment evidence'), /limit/i);
  assert.equal(run.status, 'running');
  assert.equal(run.blocks[0]!.rounds.length, 3);
});

test('unchanged failure cannot relaunch, and the same measured recovery is not reusable', context => {
  const run = approved(fixture(context));
  recordFailure(run, 'infrastructure', 'missing service');
  assert.throws(() => retry(run, 'Try again', false), /unchanged/);
  retry(run, 'Started local service', false, 'probe at 10:00 returned healthy');
  recordFailure(run, 'infrastructure', 'missing service');
  assert.throws(() => retry(run, 'Same evidence', false, 'probe at 10:00 returned healthy'), /already attempted/);
});

test('concurrent agents are bounded and overlapping writers must reconcile first', context => {
  const run = approved(fixture(context));
  registerAgent(run, { id: 'writer', role: 'applier', tier: 'terra', scope: ['app.mjs'] });
  assert.throws(() => registerAgent(run, { id: 'replacement', role: 'applier', tier: 'luna', scope: ['app.mjs'] }), /owns this scope/);
  registerAgent(run, { id: 'reader', role: 'explorer', tier: 'luna', scope: ['README.md'] });
  assert.throws(() => registerAgent(run, { id: 'third', role: 'explorer', tier: 'luna', scope: ['app.mjs'] }), /Maximum two/);
  finishAgent(run, 'writer', 'Implemented the scoped change');
  finishAgent(run, 'writer', 'Implemented the scoped change');
  assert.equal(run.agents.length, 2);
});

test('truthful coordination leaves unobserved principal work uncovered and admits its configured child capacity', context => {
  const specification = spec();
  Object.assign(specification, {
    coordination: { maxActiveAgents: 4 },
    reviewFallback: { model: 'gpt-5.6-terra', reasoningEffort: 'high' },
  });
  const run = approved(fixture(context), specification);
  assert.equal(run.version, 5);
  assert.deepEqual(run.blocks[0]!.writers, []);
  for (const [id, scope] of [['one', 'one.mjs'], ['two', 'two.mjs'], ['three', 'three.mjs'], ['four', 'four.mjs']] as const) {
    registerAgent(run, { id, role: 'explorer', tier: 'luna', scope: [scope] });
  }
  assert.throws(() => registerAgent(run, { id: 'five', role: 'explorer', tier: 'luna', scope: ['five.mjs'] }), /configured child capacity/);
});

test('truthful review coverage uses actual configuration or its approved fallback without inventing a Luna tier', async context => {
  const missingFallback = spec('missing-fallback');
  missingFallback.coordination = { maxActiveAgents: 2 };
  const uncoveredProject = fixture(context);
  approved(uncoveredProject, missingFallback);
  await executeCheck(uncoveredProject, 'unit');
  const uncovered = readRun(uncoveredProject);
  recordContribution(uncovered, { actor: uncovered.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the recorded fixture change.' });
  registerAgent(uncovered, { id: 'unranked-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-sol', reasoningEffort: 'high', forkTurns: 'none' } });
  finishAgent(uncovered, 'unranked-reviewer', 'The scoped review is complete.');
  assert.throws(() => recordReview(uncovered, { agent: 'unranked-reviewer', kind: 'general', criteria: uncovered.spec.blocks[0]!.criteria, verdict: 'pass' }), /approved review fallback/);

  const fallbackSpecification = spec('fallback-coverage');
  fallbackSpecification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' };
  const coveredProject = fixture(context);
  approved(coveredProject, fallbackSpecification);
  await executeCheck(coveredProject, 'unit');
  const covered = readRun(coveredProject);
  recordContribution(covered, { actor: covered.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the recorded fixture change.' });
  registerAgent(covered, { id: 'fallback-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } });
  finishAgent(covered, 'fallback-reviewer', 'The scoped review is complete.');
  const review = recordReview(covered, { agent: 'fallback-reviewer', kind: 'general', criteria: covered.spec.blocks[0]!.criteria, verdict: 'pass' });
  assert.equal(review.tier, undefined);
  assert.deepEqual(review.coverage!.fallback, fallbackSpecification.reviewFallback);

  const unrankedSpecification = spec('unranked-same-config');
  unrankedSpecification.coordination = { maxActiveAgents: 2 };
  unrankedSpecification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const sameConfiguration = { model: 'gpt-5.6-sol', reasoningEffort: 'high', forkTurns: 'none' } as const;
  const unrankedProject = fixture(context);
  approved(unrankedProject, unrankedSpecification);
  await executeCheck(unrankedProject, 'unit');
  const unranked = readRun(unrankedProject);
  recordObservation(unranked, { actor: unranked.spec.principal, observation: sameConfiguration });
  recordContribution(unranked, { actor: unranked.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the recorded fixture change.' });
  registerAgent(unranked, { id: 'same-config-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: sameConfiguration });
  finishAgent(unranked, 'same-config-reviewer', 'The scoped review is complete.');
  assert.equal(recordReview(unranked, { agent: 'same-config-reviewer', kind: 'general', criteria: unranked.spec.blocks[0]!.criteria, verdict: 'pass' }).tier, undefined);

  const unrankedFallback = spec('unranked-fallback');
  unrankedFallback.reviewFallback = { model: 'gpt-5.6-sol', reasoningEffort: 'high' };
  const nonOrdinalProject = fixture(context);
  approved(nonOrdinalProject, unrankedFallback);
  await executeCheck(nonOrdinalProject, 'unit');
  const nonOrdinal = readRun(nonOrdinalProject);
  recordContribution(nonOrdinal, { actor: nonOrdinal.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the recorded fixture change.' });
  registerAgent(nonOrdinal, { id: 'terra-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } });
  finishAgent(nonOrdinal, 'terra-reviewer', 'The scoped review is complete.');
  assert.throws(() => recordReview(nonOrdinal, { agent: 'terra-reviewer', kind: 'general', criteria: nonOrdinal.spec.blocks[0]!.criteria, verdict: 'pass' }), /does not cover/);
});

test('approved fallback never lowers a known model review floor', async context => {
  const specification = spec('known-floor');
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  recordObservation(run, { actor: run.spec.principal, observation: { model: 'gpt-6-astra', reasoningEffort: 'high' } });
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the fixture change.' });
  registerAgent(run, { id: 'terra-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } });
  finishAgent(run, 'terra-reviewer', 'The current implementation was reviewed independently.');
  const review = { agent: 'terra-reviewer', kind: 'general', criteria: specification.blocks[0]!.criteria, verdict: 'pass' } as const;
  assert.throws(() => recordReview(run, review), /does not cover/);
  recordObservation(run, { actor: run.spec.principal, observation: { model: 'gpt-5.6-sol', reasoningEffort: 'high' } });
  assert.deepEqual(recordReview(run, review).coverage!.fallback, specification.reviewFallback);
});

test('principal contribution labels cannot bypass observed review coverage', async context => {
  const specification = spec('principal-provenance');
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  const sol = { model: 'gpt-5.6-sol', reasoningEffort: 'high', forkTurns: 'none' } as const;
  assert.throws(() => recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal self-labeled the implementation.', configuration: sol }), /observation --file/);
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the fixture change.' });
  run.blocks[0]!.contributions![0]!.configuration = sol;
  writeRun(run);

  const persisted = readRun(project);
  registerAgent(persisted, { id: 'sol-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: sol });
  finishAgent(persisted, 'sol-reviewer', 'The fixture review is complete.');
  assert.throws(() => recordReview(persisted, { agent: 'sol-reviewer', kind: 'general', criteria: persisted.spec.blocks[0]!.criteria, verdict: 'pass' }), /approved review fallback/);
  registerAgent(persisted, { id: 'terra-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: specification.reviewFallback });
  finishAgent(persisted, 'terra-reviewer', 'The fallback fixture review is complete.');
  const review = recordReview(persisted, { agent: 'terra-reviewer', kind: 'general', criteria: persisted.spec.blocks[0]!.criteria, verdict: 'pass' });
  writeRun(persisted);

  const status = JSON.parse(captureCommand([process.execPath, cli, 'status'], project)) as {
    blocks: Array<{ accounting: { currentCoverage: { status: string; coverage: { fallback?: unknown } } } }>;
    modelAccounting: { observed: unknown[] };
  };
  assert.deepEqual(review.coverage!.fallback, specification.reviewFallback);
  assert.deepEqual(status.modelAccounting.observed, []);
  assert.equal(status.blocks[0]!.accounting.currentCoverage.status, 'satisfied');
  assert.deepEqual(status.blocks[0]!.accounting.currentCoverage.coverage.fallback, specification.reviewFallback);
});

test('retained unknown authors remain covered alongside new attributed contributions', async context => {
  const specification = spec('mixed-authors');
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  run.blocks[0]!.unattributedWriters = ['legacy-author'];
  run.blocks[0]!.writers.push('legacy-author');
  recordObservation(run, { actor: run.spec.principal, observation: { model: 'gpt-5.6-luna', reasoningEffort: 'max' } });
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the current fixture change.' });
  registerAgent(run, { id: 'luna-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-luna', reasoningEffort: 'max', forkTurns: 'none' } });
  finishAgent(run, 'luna-reviewer', 'The new attributed contribution is covered.');
  assert.throws(() => recordReview(run, { agent: 'luna-reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' }), /approved review fallback/);
  registerAgent(run, { id: 'terra-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } });
  finishAgent(run, 'terra-reviewer', 'Both retained and current implementation evidence are covered.');
  assert.doesNotThrow(() => recordReview(run, { agent: 'terra-reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' }));
});

test('a changed final reviewer observation invalidates pending plan closure', async context => {
  const specification = spec('final-observation');
  specification.mode = 'plan';
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  const configuration = { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } as const;
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the fixture change.' });
  registerAgent(run, { id: 'block-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration });
  finishAgent(run, 'block-reviewer', 'The block review passed.');
  recordReview(run, { agent: 'block-reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(run);
  registerAgent(run, { id: 'final-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration }, true);
  finishAgent(run, 'final-reviewer', 'The cumulative review passed.');
  recordReview(run, { agent: 'final-reviewer', kind: 'general', criteria: ['rubric', 'conformance'], verdict: 'pass' }, true);
  registerAgent(run, { id: 'final-reviewer', observation: { model: 'gpt-5.6-sol', reasoningEffort: 'high' } });
  assert.throws(() => closeRun(run), /configuration does not cover/);
});

test('truthful records reject corrupt contributor relationships without replacing valid persisted evidence', async context => {
  const specification = spec('relational-record');
  specification.coordination = { maxActiveAgents: 2 };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  const configuration = { model: 'gpt-5.6-luna', reasoningEffort: 'max', forkTurns: 'none' } as const;
  registerAgent(run, { id: 'applier', role: 'applier', scope: ['app.mjs'], configuration });
  finishAgent(run, 'applier', 'The scoped implementation was delivered.');
  recordContribution(run, { actor: 'applier', scope: ['app.mjs'], evidence: 'The delivered applier implemented the scoped fixture change.' });
  writeRun(run);
  const filename = path.join(project, '.oso-code-codex/runs/relational-record.json');
  const valid = readFileSync(filename, 'utf8');
  const malformed = JSON.parse(valid) as ReturnType<typeof readRun>;
  malformed.blocks[0]!.contributions![0]!.actor = 'unknown-applier';
  writeFileSync(filename, JSON.stringify(malformed));
  assert.throws(() => readRun(project), /contribution lacks its delivered assigned native author/);
  writeFileSync(filename, valid);
  const unlinkedObservation = JSON.parse(valid) as ReturnType<typeof readRun>;
  unlinkedObservation.agents[0]!.observedConfiguration = { model: 'gpt-5.6-sol', reasoningEffort: 'high' };
  writeFileSync(filename, JSON.stringify(unlinkedObservation));
  assert.throws(() => readRun(project), /native assignment history is malformed/);
  writeFileSync(filename, valid);
  const omittedLegacyAuthor = JSON.parse(valid) as ReturnType<typeof readRun>;
  omittedLegacyAuthor.blocks[0]!.unattributedWriters = ['legacy-author'];
  writeFileSync(filename, JSON.stringify(omittedLegacyAuthor));
  assert.throws(() => readRun(project), /writers omit or invent retained authors/);
  writeFileSync(filename, valid);
  const invalidWrite = readRun(project);
  invalidWrite.blocks[0]!.contributions![0]!.scope = ['README.md'];
  assert.throws(() => writeRun(invalidWrite), /contribution lacks its delivered assigned native author/);
  assert.equal(readFileSync(filename, 'utf8'), valid);
});

test('observations reopen only open coverage and preserve the closed review record', async context => {
  const specification = spec('observations');
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the fixture change.' });
  const requested = { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } as const;
  registerAgent(run, { id: 'reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: requested });
  finishAgent(run, 'reviewer', 'Initial independent review passed.');
  const initial = recordReview(run, { agent: 'reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' });
  registerAgent(run, { id: 'reviewer', observation: { model: 'gpt-5.6-sol', reasoningEffort: 'high' } });
  assert.throws(() => closeBlock(run), /does not cover/);
  assert.deepEqual(initial.coverage!.requested, requested);
  registerAgent(run, { id: 'fresh-reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: requested });
  finishAgent(run, 'fresh-reviewer', 'Current independent review passed.');
  recordReview(run, { agent: 'fresh-reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(run);
  recordObservation(run, { actor: run.spec.principal, observation: { model: 'gpt-5.6-terra', reasoningEffort: 'high' } });
  registerAgent(run, { id: 'reviewer', observation: { model: 'gpt-5.6-terra', reasoningEffort: 'high' } });
  assert.deepEqual(initial.coverage!.requested, requested);
  assert.equal(run.principalObservations!.length, 1);
});

test('compact status separates historical coverage from current pending configuration coverage', async context => {
  const specification = spec('status-coverage');
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const project = fixture(context);
  approved(project, specification);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'Principal implemented the fixture change.' });
  const requested = { model: 'gpt-5.6-terra', reasoningEffort: 'high', forkTurns: 'none' } as const;
  registerAgent(run, { id: 'reviewer', role: 'reviewer', scope: ['app.mjs'], configuration: requested });
  finishAgent(run, 'reviewer', 'The initial independent review passed.');
  recordReview(run, { agent: 'reviewer', kind: 'general', criteria: run.spec.blocks[0]!.criteria, verdict: 'pass' });
  recordObservation(run, { actor: 'reviewer', observation: { model: 'gpt-5.6-sol', reasoningEffort: 'high' } });
  writeRun(run);
  const status = JSON.parse(captureCommand([process.execPath, cli, 'status'], project)) as {
    blocks: Array<{ accounting: { historicalCoverage: { fallback?: unknown }; currentCoverage: { status: string; reason?: string } } }>;
  };
  assert.deepEqual(status.blocks[0]!.accounting.historicalCoverage.fallback, specification.reviewFallback);
  assert.equal(status.blocks[0]!.accounting.currentCoverage.status, 'pending');
  assert.match(status.blocks[0]!.accounting.currentCoverage.reason!, /does not cover/);
});

test('truthful followups retain assignments and replacements preserve their predecessor history', context => {
  const specification = spec('assignment-history');
  specification.coordination = { maxActiveAgents: 4 };
  const project = fixture(context);
  const run = approved(project, specification);
  const configuration = { model: 'gpt-5.6-luna', reasoningEffort: 'max', forkTurns: 'none' } as const;
  registerAgent(run, { id: 'applier', role: 'applier', scope: ['app.mjs'], configuration });
  finishAgent(run, 'applier', 'First directed implementation result.');
  recordContribution(run, { actor: 'applier', scope: ['app.mjs'], evidence: 'The first delivered assignment implemented this scope.' });
  registerAgent(run, { id: 'applier', role: 'applier', scope: ['app.mjs'], configuration });
  writeRun(run);
  assert.equal(readRun(project).blocks[0]!.contributions![0]!.actor, 'applier');
  finishAgent(run, 'applier', 'Second directed implementation result.');
  registerAgent(run, { id: 'replacement', role: 'applier', scope: ['README.md'], configuration, replaces: 'applier' });
  assert.equal(run.agents.find(agent => agent.id === 'applier')!.deliveries!.length, 2);
  assert.equal(run.agents.find(agent => agent.id === 'applier')!.assignments!.length, 2);
  assert.equal(run.agents.find(agent => agent.id === 'replacement')!.replacementFor, 'applier');
});

test('truthful writers retain overlap protection independently from the configured capacity', context => {
  const specification = spec('writer-capacity');
  specification.coordination = { maxActiveAgents: 4 };
  const run = approved(fixture(context), specification);
  const configuration = { model: 'gpt-5.6-luna', reasoningEffort: 'max', forkTurns: 'none' } as const;
  registerAgent(run, { id: 'writer', role: 'applier', scope: ['app.mjs'], configuration });
  assert.throws(() => registerAgent(run, { id: 'overlap', role: 'applier', scope: ['app.mjs'], configuration }), /owns this scope/);
  for (const id of ['two', 'three', 'four']) registerAgent(run, { id, role: 'explorer', scope: [`${id}.mjs`], configuration });
  assert.throws(() => registerAgent(run, { id: 'five', role: 'explorer', scope: ['five.mjs'], configuration }), /configured child capacity/);
});

test('authorized promotion retains legacy writers as unknown implementation authors', context => {
  const project = fixture(context);
  const run = approved(project, spec('promotion'));
  const amendment = structuredClone(run.spec);
  amendment.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  amendRun(project, amendment, 'promotion-turn');
  const promoted = readRun(project);
  assert.equal(promoted.version, 5);
  assert.deepEqual(promoted.blocks[0]!.writers, ['native-parent']);
  assert.deepEqual(promoted.blocks[0]!.unattributedWriters, ['native-parent']);
  assert.deepEqual(promoted.blocks[0]!.contributions, []);
});

test('amending a truthful zero-writer run retains an empty attributed record without legacy metadata', context => {
  const project = fixture(context);
  const specification = spec('truthful-zero-writers');
  specification.coordination = { maxActiveAgents: 4 };
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const run = approved(project, specification);
  const amendment = structuredClone(run.spec);
  amendment.decisions.push('Retain truthful empty authorship while adding the approved implementation note.');

  amendRun(project, amendment, 'truthful-zero-writers-turn');

  const amended = readRun(project);
  assert.deepEqual(amended.blocks[0]!.writers, []);
  assert.deepEqual(amended.blocks[0]!.contributions, []);
  assert.equal(amended.blocks[0]!.unattributedWriters, undefined);
});

test('amending a truthful attributed run preserves contributions without relabeling its writer as legacy', context => {
  const project = fixture(context);
  const specification = spec('truthful-attributed-writer');
  specification.coordination = { maxActiveAgents: 4 };
  specification.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  const run = approved(project, specification);
  recordContribution(run, { actor: run.spec.principal, scope: ['app.mjs'], evidence: 'The principal implemented the current fixture change.' });
  writeRun(run);
  const contributions = structuredClone(readRun(project).blocks[0]!.contributions);
  const amendment = structuredClone(run.spec);
  amendment.decisions.push('Retain the attributed implementation while adding the approved implementation note.');

  amendRun(project, amendment, 'truthful-attributed-writer-turn');

  const amended = readRun(project);
  assert.deepEqual(amended.blocks[0]!.writers, ['native-parent']);
  assert.deepEqual(amended.blocks[0]!.contributions, contributions);
  assert.equal(amended.blocks[0]!.unattributedWriters, undefined);
});

test('a failed check permits one corrective agent without clearing the failure or allowing replacements', context => {
  const run = approved(fixture(context));
  recordFailure(run, 'product', 'Expected regression fails');
  registerAgent(run, { id: 'repair-agent', role: 'applier', tier: 'luna', scope: ['app.mjs'] });
  finishAgent(run, 'repair-agent', 'Actual directed correction result');
  assert.throws(() => registerAgent(run, { id: 'replacement', role: 'applier', tier: 'luna', scope: ['app.mjs'] }), /already has a native agent/);
  assert.equal(run.blocks[0]!.failure!.cause, 'Expected regression fails');
  assert.equal(run.blocks[0]!.rounds.length, 0);
});

test('reviewer cannot silently downgrade an escalated implementation', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  registerAgent(run, { id: 'writer', role: 'applier', tier: 'terra', scope: ['app.mjs'] });
  finishAgent(run, 'writer', 'Done');
  assert.throws(() => reviewed(run), /Reviewer tier/);
});

test('legacy import preserves its source and does not promote old green flags', context => {
  const project = fixture(context);
  const run = startRun(project, spec());
  const legacy = path.join(project, 'legacy.json');
  writeFileSync(legacy, '{"verify_green":true,"approved":true}');
  const before = readFileSync(legacy);
  importLegacy(run, legacy);
  assert.equal(run.status, 'pending-approval');
  assert.equal(run.checks.length, 0);
  assert.equal(run.imports[0]!.digest, digest(before));
  assert.deepEqual(readFileSync(legacy), before);
});

test('declared ignored inputs and zero-depth recursive globs invalidate obsolete evidence', context => {
  const project = fixture(context);
  writeFileSync(path.join(project, '.gitignore'), 'build.json\n');
  writeFileSync(path.join(project, 'build.json'), '{"target":"old"}');
  const check = spec().checks[0]!;
  check.inputs = ['build.json', '**/*.mjs'];
  const before = checkFingerprint(project, check);
  writeFileSync(path.join(project, 'build.json'), '{"target":"new"}');
  assert.notEqual(checkFingerprint(project, check), before);
  assert.equal(scopeMatches('src/app.ts', ['src/**/*.ts']), true);
  assert.equal(scopeMatches('src/nested/app.ts', ['src/**/*.ts']), true);
  assert.equal(scopeMatches('app.ts', ['**/*.ts']), true);
  assert.equal(scopeMatches('app.ts', ['src/**/*.ts']), false);
});

test('a narrow reviewer cannot attest to an unreviewed block scope', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  registerAgent(run, { id: 'narrow', role: 'reviewer', tier: 'luna', scope: ['README.md'] });
  finishAgent(run, 'narrow', 'README is clear');
  assert.throws(() => recordReview(run, { agent: 'narrow', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance', 'price'] }), /does not cover/);
});

test('late changes outside every reviewed block cannot close the run', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  reviewed(run);
  closeBlock(run);
  writeFileSync(path.join(project, 'README.md'), 'Unapproved late work');
  assert.throws(() => closeRun(run), /outside approved run scope/);
});

test('cumulative review must cover the current command attempts, including environment changes', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.mode = 'plan';
  specification.checks[0]!.envKeys = ['OSO_CODEX_PLAN_ENV'];
  approved(project, specification);
  await executeCheck(project, 'unit');
  let run = readRun(project);
  reviewed(run);
  recordReview(run, { agent: 'native-reviewer', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance'] }, true);
  writeRun(run);
  process.env.OSO_CODEX_PLAN_ENV = 'changed';
  try {
    await executeCheck(project, 'unit');
    run = readRun(project);
    recordReview(run, { agent: 'native-reviewer', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance', 'price'] });
    closeBlock(run);
    assert.throws(() => closeRun(run), /Cumulative independent/);
    recordReview(run, { agent: 'native-reviewer', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance'] }, true);
    closeRun(run);
  } finally { delete process.env.OSO_CODEX_PLAN_ENV; }
});

test('measured prose cannot reopen an unchanged product defect', context => {
  const run = approved(fixture(context));
  recordFailure(run, 'product', 'price is incorrect');
  assert.throws(() => retry(run, 'Retry the same code', false, 'New wording for the same cause'), /unchanged/);
});

test('a running executor cannot be duplicated and a timed-out command remains blocked', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, '-e', 'setTimeout(() => console.log("PASS"), 300)'];
  specification.checks[0]!.timeoutMs = 30;
  approved(project, specification);
  const owned = executeCheck(project, 'unit');
  await assert.rejects(executeCheck(project, 'unit'), /still running/);
  const result = await owned;
  assert.equal(result.status, 'blocked');
  assert.equal(readRun(project).checks.length, 1);
});

test('reconcile preserves a live child and retains incomplete evidence after interruption', context => {
  const project = fixture(context);
  const run = approved(project);
  mkdirSync(path.join(project, '.oso-code-codex/logs'), { recursive: true });
  const log = path.join(project, '.oso-code-codex/logs/interrupted.log');
  writeFileSync(log, 'Partial output\n');
  run.checks.push({ id: 'unit', attempt: 'interrupted', block: 'price', command: ['node'], cwd: project, fingerprint: 'before', started: new Date().toISOString(), status: 'running', log, diagnostics: [], runner: processIdentity(1_000_000_000), child: processIdentity(process.pid) });
  reconcile(run);
  assert.equal(run.checks[0]!.status, 'running');
  delete run.checks[0]!.child;
  reconcile(run);
  assert.equal(run.checks[0]!.status, 'interrupted');
  assert.equal(readFileSync(log, 'utf8'), 'Partial output\n');
  assert.equal(run.blocks[0]!.failure!.kind, 'infrastructure');
});

test('another PID namespace stays unresolved until actual native completion is confirmed', context => {
  const project = fixture(context);
  const run = approved(project);
  const log = path.join(project, '.oso-code-codex/partial.log');
  writeFileSync(log, 'Partial evidence');
  const owner = { pid: 1_000_000_000, namespace: 'another-native-namespace', start: 'original' };
  run.checks.push({ id: 'unit', attempt: 'foreign', block: 'price', command: ['node'], cwd: project, fingerprint: 'before', started: new Date().toISOString(), status: 'running', log, diagnostics: [], runner: owner });
  reconcile(run);
  assert.equal(run.checks[0]!.status, 'running');
  assert.throws(() => confirmStoppedCheck(run, 'foreign', ''), /actual native/);
  confirmStoppedCheck(run, 'foreign', 'Native session fixture ended with exit 137; no child remains');
  assert.equal(run.checks[0]!.status, 'interrupted');
  assert.equal(run.blocks[0]!.failure!.kind, 'infrastructure');
  assert.equal(readFileSync(log, 'utf8'), 'Partial evidence');
  run.checks[0]!.status = 'running';
  run.checks[0]!.runner = processIdentity(process.pid);
  assert.throws(() => confirmStoppedCheck(run, 'foreign', 'Incorrect claim'), /visibly still alive/);
});

test('a broad glob reviewer can cover a literal scope and retain directed delivery history', async context => {
  const project = fixture(context);
  approved(project);
  await executeCheck(project, 'unit');
  const run = readRun(project);
  registerAgent(run, { id: 'same-reviewer', role: 'reviewer', tier: 'luna', scope: ['**/*.mjs'] });
  finishAgent(run, 'same-reviewer', 'Initial inspection');
  registerAgent(run, { id: 'same-reviewer', role: 'reviewer', tier: 'luna', scope: ['**/*.mjs'] });
  finishAgent(run, 'same-reviewer', 'Directed confirmation with executed evidence');
  recordReview(run, { agent: 'same-reviewer', kind: 'general', verdict: 'pass', criteria: ['rubric', 'conformance', 'price'] });
  assert.equal(run.agents[0]!.deliveries!.length, 2);
  assert.equal(run.agents[0]!.deliveries![0]!.report, 'Initial inspection');
});

test('decision recovery requires a real amendment and distinguishes successive authorizations', context => {
  const run = approved(fixture(context));
  for (let revision = 0; revision < 2; revision++) {
    recordFailure(run, 'decision', 'Choose rounding contract');
    assert.throws(() => retry(run, 'No decision yet', false, 'Some prose'), /requires actual user authorization/);
    run.approval = { kind: 'user', reference: `new-user-turn-${revision}`, message: `Approved rounding contract revision ${revision}`, specDigest: run.specDigest };
    retry(run, 'The user resolved the recorded contract choice', false);
  }
  assert.equal(run.blocks[0]!.rounds.length, 2);
  recordFailure(run, 'decision', 'An old record lacks its authorization identity');
  delete (run.blocks[0]!.failure as { approvalDigest?: string }).approvalDigest;
  assert.throws(() => retry(run, 'Do not infer approval from missing history', true), /requires actual user authorization/);
});

function amendRun(project: string, specification: ReturnType<typeof spec>, reference: string): void {
  const document = path.join(project, `${reference}.json`);
  writeFileSync(document, JSON.stringify({ specification, authorization: { kind: 'user', reference, message: `Approve the truthful accounting amendment ${reference}.` } }));
  captureCommand([process.execPath, cli, 'amend', '--file', document, '--authorization', document], project);
}
