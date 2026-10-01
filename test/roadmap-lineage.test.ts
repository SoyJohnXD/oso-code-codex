import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck, validCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { activateBlock } from '../src/lifecycle.ts';
import { closeBlock, closeRun, finishAgent, recordContribution, recordReview, registerAgent } from '../src/reviews.ts';
import { readRun, stateDirectory, writeRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('an additive user amendment preserves a closed roadmap child for its dependent sibling', async context => {
  const project = fixture(context);
  const roadmap = spec('wimm-roadmap');
  roadmap.mode = 'roadmap';
  roadmap.children = [spec('build-wimm'), spec('verify-wimm')];
  roadmap.children![1]!.dependsOn = ['build-wimm'];
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);

  const amendment = structuredClone(roadmap.children[0]!);
  amendment.decisions.push('Preserve the existing Wimm delivery contract while adding the approved rollout note');
  amendChild(project, amendment, 'fixture-wimm-amendment');

  await closeCurrentChild(project, 'wimm-reviewer');

  captureCommand([process.execPath, cli, 'child', 'verify-wimm', '--run', roadmap.id], project);
  assert.equal(readRun(project).spec.id, 'verify-wimm');
});

test('amending a truthful zero-writer roadmap child retains an empty attributed record without legacy metadata', context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  roadmap.children![0]!.coordination = { maxActiveAgents: 4 };
  roadmap.children![0]!.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  const amendment = structuredClone(readRun(project).spec);
  amendment.decisions.push('Retain truthful empty authorship while adding the approved Wimm implementation note.');

  amendChild(project, amendment, 'fixture-wimm-truthful-zero-writers');

  const amended = readRun(project);
  assert.deepEqual(amended.blocks[0]!.writers, []);
  assert.deepEqual(amended.blocks[0]!.contributions, []);
  assert.equal(amended.blocks[0]!.unattributedWriters, undefined);
});

test('amending a truthful attributed roadmap child preserves contributions without legacy relabeling', context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  roadmap.children![0]!.coordination = { maxActiveAgents: 4 };
  roadmap.children![0]!.reviewFallback = { model: 'gpt-5.6-terra', reasoningEffort: 'high' };
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  const child = readRun(project);
  recordContribution(child, { actor: child.spec.principal, scope: ['app.mjs'], evidence: 'The principal implemented the current Wimm fixture change.' });
  writeRun(child);
  const contributions = structuredClone(readRun(project).blocks[0]!.contributions);
  const amendment = structuredClone(child.spec);
  amendment.decisions.push('Retain the attributed implementation while adding the approved Wimm implementation note.');

  amendChild(project, amendment, 'fixture-wimm-truthful-attributed-writer');

  const amended = readRun(project);
  assert.deepEqual(amended.blocks[0]!.writers, ['native-parent']);
  assert.deepEqual(amended.blocks[0]!.contributions, contributions);
  assert.equal(amended.blocks[0]!.unattributedWriters, undefined);
});

test('an amended closed checkpoint returns to pending when its verification contract expands', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  roadmap.children![0]!.blocks.push({ id: 'release-wimm', goal: 'Prepare the Wimm release', scope: ['app.mjs'], criteria: ['rubric', 'conformance'], checks: ['unit'] });
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);

  assert.equal((await executeCheck(project, 'unit')).status, 'pass');
  const child = readRun(project);
  registerAgent(child, { id: 'initial-wimm-reviewer', role: 'reviewer', tier: 'luna', scope: child.spec.blocks[0]!.scope });
  finishAgent(child, 'initial-wimm-reviewer', 'Independent review covers the initial Wimm build contract.');
  recordReview(child, { agent: 'initial-wimm-reviewer', kind: 'general', criteria: child.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(child);
  activateBlock(child, 'release-wimm');
  writeRun(child);

  const amendment = structuredClone(child.spec);
  amendment.blocks[0]!.criteria.push('rollout readiness');
  amendChild(project, amendment, 'fixture-wimm-expanded-contract');

  const reopened = readRun(project);
  assert.equal(reopened.blocks[0]!.status, 'pending');
  assert.equal(reopened.blocks[0]!.reviews.length, 1);
});

test('a replacement child blocks its dependent but leaves an independent sibling selectable', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  roadmap.children!.push(spec('publish-wimm'));
  roadmap.children![1]!.dependsOn = ['build-wimm'];
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);

  const replacement = structuredClone(readRun(project).spec);
  replacement.objective = 'Replace the original Wimm build obligation with a separate migration';
  amendChild(project, replacement, 'fixture-wimm-replacement');
  await closeCurrentChild(project, 'replacement-wimm-reviewer');

  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'verify-wimm', '--run', roadmap.id], project), /dependency/i);
  captureCommand([process.execPath, cli, 'child', 'publish-wimm', '--run', roadmap.id], project);
  assert.equal(readRun(project).spec.id, 'publish-wimm');
});

test('an amended check definition cannot reuse the former check result', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  assert.equal((await executeCheck(project, 'unit')).status, 'pass');

  const amendment = structuredClone(readRun(project).spec);
  amendment.checks[0]!.command = [process.execPath, '-e', 'console.log("WIMM PASS")'];
  amendChild(project, amendment, 'fixture-wimm-check-replacement');

  assert.equal(validCheck(readRun(project), 'unit'), undefined);
});

test('a changed shared check reopens only closed blocks that require it', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  const child = roadmap.children![0]!;
  child.checks.push({ id: 'audit', command: [process.execPath, '-e', 'console.log("AUDIT PASS")'], inputs: ['app.mjs'] });
  child.blocks.push(
    { id: 'audit-wimm', goal: 'Audit the Wimm build', scope: ['app.mjs'], criteria: ['rubric', 'conformance'], checks: ['audit'] },
    { id: 'release-wimm', goal: 'Prepare the Wimm release', scope: ['app.mjs'], criteria: ['rubric', 'conformance'], checks: ['unit'] },
  );
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  await closeActiveBlock(project, 'unit', 'build-wimm-reviewer');
  const afterBuild = readRun(project);
  activateBlock(afterBuild, 'audit-wimm');
  writeRun(afterBuild);
  await closeActiveBlock(project, 'audit', 'audit-wimm-reviewer');
  const beforeAmendment = readRun(project);
  activateBlock(beforeAmendment, 'release-wimm');
  writeRun(beforeAmendment);

  const amendment = structuredClone(beforeAmendment.spec);
  amendment.checks[0]!.command = [process.execPath, '-e', 'console.log("UPDATED WIMM PASS")'];
  amendChild(project, amendment, 'fixture-wimm-shared-check');

  const reopened = readRun(project);
  assert.equal(reopened.blocks.find(block => block.id === 'price')!.status, 'pending');
  assert.equal(reopened.blocks.find(block => block.id === 'audit-wimm')!.status, 'closed');
  assert.equal(reopened.blocks.find(block => block.id === 'release-wimm')!.status, 'active');
});

test('a closed additive legacy child reconciles once and restores its dependent sibling', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  const amendment = structuredClone(readRun(project).spec);
  amendment.decisions.push('Retain the reviewed build while recording the approved Wimm rollout note');
  amendChild(project, amendment, 'fixture-wimm-legacy-approval');
  await closeCurrentChild(project, 'legacy-wimm-reviewer');

  const legacy = readRun(project, 'build-wimm');
  legacy.version = 2;
  delete legacy.readerMinimumVersion;
  delete legacy.roadmapLineage;
  writeRun(legacy);
  captureCommand([process.execPath, cli, 'roadmap', 'reconcile', '--run', roadmap.id, '--child', 'build-wimm'], project);
  captureCommand([process.execPath, cli, 'roadmap', 'reconcile', '--run', roadmap.id, '--child', 'build-wimm'], project);

  const reconciled = readRun(project, 'build-wimm');
  assert.equal(reconciled.version, 5);
  assert.equal(reconciled.roadmapLineage!.amendments[0]!.provenance, 'legacy-reconcile');
  assert.equal(reconciled.roadmapLineage!.amendments[0]!.authorization.reference, 'fixture-wimm-legacy-approval');
  captureCommand([process.execPath, cli, 'child', 'verify-wimm', '--run', roadmap.id], project);
  assert.equal(readRun(project).spec.id, 'verify-wimm');
});

test('an exact legacy child without an origin retains its roadmap authority', async context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);

  const legacy = readRun(project);
  legacy.version = 2;
  delete legacy.readerMinimumVersion;
  delete legacy.roadmapOrigin;
  delete legacy.roadmapLineage;
  legacy.status = 'closed';
  delete legacy.activeBlock;
  legacy.blocks[0]!.status = 'closed';
  writeRun(legacy);
  captureCommand([process.execPath, cli, 'child', 'verify-wimm', '--run', roadmap.id], project);
  assert.equal(readRun(project).spec.id, 'verify-wimm');
});

test('readers reject discontinuous lineage before selection or evidence reuse', context => {
  for (const mutation of [
    (run: ReturnType<typeof readRun>) => { run.roadmapLineage!.amendments[0]!.fromDigest = '0'.repeat(64); },
    (run: ReturnType<typeof readRun>) => {
      const baseline = run.roadmapLineage!.baseline.originalSpecDigest;
      run.roadmapLineage!.amendments[0]!.toDigest = baseline;
      run.roadmapLineage!.amendments[0]!.authorization.specDigest = baseline;
      run.spec = wimmRoadmap().children![0]!;
      run.specDigest = baseline;
    },
    (run: ReturnType<typeof readRun>) => { run.roadmapLineage!.amendments[0]!.authorization.specDigest = 'f'.repeat(64); },
  ]) {
    const project = fixture(context);
    const roadmap = wimmRoadmap();
    approved(project, roadmap);
    captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
    const amendment = structuredClone(readRun(project).spec);
    amendment.decisions.push('Add the approved Wimm note before tampering with the durable lineage.');
    amendChild(project, amendment, 'fixture-wimm-lineage');
    const malformed = readRun(project);
    mutation(malformed);
    writeRawRun(project, malformed);
    assert.throws(() => readRun(project, 'build-wimm'), /lineage|migration/i);
  }
});

test('selection rejects a lineage bound to another parent and readers retain the prior atomic record beside an interrupted temporary file', context => {
  const project = fixture(context);
  const roadmap = wimmRoadmap();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'build-wimm', '--run', roadmap.id], project);
  const child = readRun(project);
  const filename = path.join(stateDirectory(project), 'runs', 'build-wimm.json');
  writeFileSync(`${filename}.interrupted.tmp`, '{not valid json');
  assert.equal(readRun(project, 'build-wimm').spec.id, 'build-wimm');

  child.roadmapOrigin!.parentRun = 'other-roadmap';
  child.roadmapLineage!.baseline.parentRun = 'other-roadmap';
  writeRawRun(project, child);
  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'verify-wimm', '--run', roadmap.id], project), /origin|lineage/i);
});

function wimmRoadmap() {
  const roadmap = spec('wimm-roadmap');
  roadmap.mode = 'roadmap';
  roadmap.children = [spec('build-wimm'), spec('verify-wimm')];
  roadmap.children[1]!.dependsOn = ['build-wimm'];
  return roadmap;
}

function amendChild(project: string, specification: ReturnType<typeof spec>, reference: string): void {
  const amendmentFile = path.join(project, '.oso-code-codex', `${reference}.json`);
  writeFileSync(amendmentFile, JSON.stringify({ specification, authorization: { kind: 'user', reference, message: `Approve the current Wimm amendment ${reference}.` } }));
  captureCommand([process.execPath, cli, 'amend', '--file', amendmentFile, '--authorization', amendmentFile], project);
}

async function closeCurrentChild(project: string, reviewer: string): Promise<void> {
  assert.equal((await executeCheck(project, 'unit')).status, 'pass');
  const child = readRun(project);
  registerAgent(child, { id: reviewer, role: 'reviewer', tier: 'luna', scope: child.spec.blocks[0]!.scope });
  finishAgent(child, reviewer, 'Independent review covers the current Wimm child contract and executed check.');
  recordReview(child, { agent: reviewer, kind: 'general', criteria: child.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(child);
  closeRun(child);
  writeRun(child);
}

async function closeActiveBlock(project: string, check: string, reviewer: string): Promise<void> {
  assert.equal((await executeCheck(project, check)).status, 'pass');
  const child = readRun(project);
  const block = child.spec.blocks.find(block => block.id === child.activeBlock)!;
  registerAgent(child, { id: reviewer, role: 'reviewer', tier: 'luna', scope: block.scope });
  finishAgent(child, reviewer, `Independent review covers the current ${block.id} Wimm checkpoint.`);
  recordReview(child, { agent: reviewer, kind: 'general', criteria: block.criteria, verdict: 'pass' });
  closeBlock(child);
  writeRun(child);
}

function writeRawRun(project: string, run: ReturnType<typeof readRun>): void {
  writeFileSync(path.join(stateDirectory(project), 'runs', `${run.spec.id}.json`), JSON.stringify(run));
}
