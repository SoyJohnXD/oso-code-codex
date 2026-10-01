import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { startRun } from '../src/lifecycle.ts';
import { parkRun } from '../src/parking.ts';
import { digest } from '../src/project.ts';
import { closeBlock, closeRun, finishAgent, recordReview, registerAgent } from '../src/reviews.ts';
import { parseSpec } from '../src/schema.ts';
import { readRun, selectRun, writeRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('an unrelated pending run cannot become a roadmap child merely by matching its specification', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  startRun(project, roadmap.children![0]!, { deferSelection: true });
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 9;\n');
  approved(project, roadmap);
  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project), /origin|parent/i);
  assert.equal(readRun(project, 'alpha').status, 'pending-approval');
  assert.equal(readRun(project).spec.id, 'roadmap');
});

test('an interrupted pending child resumes from its initially persisted exact roadmap origin', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  const parent = approved(project, roadmap);
  const pending = startRun(project, roadmap.children![0]!, { deferSelection: true });
  assert.equal(readRun(project, 'alpha').status, 'pending-approval');
  assert.deepEqual(readRun(project, 'alpha').roadmapOrigin, { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: 'alpha' });
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  assert.equal(readRun(project).status, 'running');
  assert.equal(readRun(project).created, pending.created);
  assert.deepEqual(readRun(project).baseline, pending.baseline);
});

test('a clean parked roadmap child yields to an independently ready sibling', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  const alpha = readRun(project);
  parkRun(alpha, 'Allow the independently approved sibling to proceed');
  writeRun(alpha);
  captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project);
  assert.equal(readRun(project).spec.id, 'beta');
  assert.equal(readRun(project, 'alpha').status, 'parked');
});

test('a roadmap sibling dependency blocks selection until the preceding child closes', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  roadmap.children![1]!.dependsOn = ['alpha'];
  approved(project, roadmap);
  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project), /dependency/i);
});

test('an active sibling remains selected when another child is requested', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project), /remains active/i);
  assert.equal(readRun(project).spec.id, 'alpha');
});

test('an unrelated selected run cannot be displaced through a roadmap --run reference', context => {
  const project = fixture(context);
  const roadmap = approved(project, roadmapSpec());
  const foreign = structuredClone(roadmap);
  foreign.spec = spec('foreign');
  foreign.specDigest = digest(JSON.stringify(foreign.spec));
  foreign.approval = { kind: 'user', reference: 'fixture-native-turn', message: 'Keep the unrelated run active', specDigest: foreign.specDigest };
  foreign.activeBlock = 'price';
  foreign.status = 'running';
  writeRun(foreign);
  selectRun(foreign);
  assert.throws(() => captureCommand([process.execPath, cli, 'child', 'alpha', '--run', roadmap.spec.id], project), /unrelated.*active/i);
  assert.equal(readRun(project).spec.id, 'foreign');
});

test('schema rejects top-level and non-preceding roadmap child dependencies', () => {
  const standalone = spec('standalone');
  standalone.dependsOn = ['earlier'];
  assert.throws(() => parseSpec(standalone), /only valid for a roadmap child/i);
  const roadmap = roadmapSpec();
  roadmap.children![1]!.dependsOn = ['beta'];
  assert.throws(() => parseSpec(roadmap), /preceding sibling/i);
});

test('a parked child resumes its own partial work when no sibling contribution intervened', context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  const alpha = readRun(project);
  parkRun(alpha, 'Keep this partial child work for its own resumed execution');
  writeRun(alpha);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  assert.equal(readRun(project).status, 'running');
  assert.equal(readRun(project).spec.id, 'alpha');
  assert.equal(captureCommand(['git', 'diff', '--', 'app.mjs'], project).includes('price = 7'), true);
});

test('a parked child resumes with its original baseline after a reviewed committed sibling', async context => {
  const project = fixture(context);
  const roadmap = roadmapSpec();
  roadmap.children![1]!.blocks[0]!.scope = ['README.md'];
  roadmap.children![1]!.checks[0]!.inputs = ['README.md'];
  roadmap.children![1]!.checks[0]!.command = [process.execPath, '-e', 'require("node:assert/strict").equal(require("node:fs").readFileSync("README.md", "utf8"), "Corrected\\n")'];
  const parent = approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  const alpha = readRun(project);
  parkRun(alpha, 'Perform the independent documentation sibling first');
  writeRun(alpha);
  captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project);
  writeFileSync(path.join(project, 'README.md'), 'Corrected\n');
  const verification = await executeCheck(project, 'unit');
  assert.equal(verification.status, 'pass');
  const beta = readRun(project);
  registerAgent(beta, { id: 'beta-reviewer', role: 'reviewer', tier: 'luna', scope: ['README.md'] });
  finishAgent(beta, 'beta-reviewer', 'Independent review covers the documented correction and executed assertion.');
  recordReview(beta, { agent: 'beta-reviewer', kind: 'general', criteria: beta.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(beta);
  closeRun(beta);
  writeRun(beta);
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'reviewed beta'], project);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', parent.spec.id], project);
  const resumed = readRun(project);
  assert.equal(resumed.spec.id, 'alpha');
  assert.equal(resumed.status, 'running');
  assert.deepEqual(resumed.baseline, alpha.baseline);
  assert.equal(resumed.externalContributions![0]!.sourceRun, 'beta');
});

test('nested parked siblings preserve reviewed contribution provenance when returning to the first child', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'notes.md'), 'Initial notes\n');
  writeFileSync(path.join(project, 'details.md'), 'Initial details\n');
  captureCommand(['git', 'add', 'notes.md', 'details.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'notes fixture'], project);
  const roadmap = roadmapSpec();
  roadmap.children!.push(spec('gamma'), spec('delta'));
  configureFileChild(roadmap.children![1]!, 'README.md', 'Beta correction\n');
  configureFileChild(roadmap.children![2]!, 'notes.md', 'Gamma correction\n');
  configureFileChild(roadmap.children![3]!, 'details.md', 'Delta correction\n');
  approved(project, roadmap);
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  const alpha = readRun(project);
  parkRun(alpha, 'Return after the independently reviewed sibling chain completes');
  writeRun(alpha);
  captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project);
  const beta = readRun(project);
  parkRun(beta, 'Allow the final independent sibling to complete first');
  writeRun(beta);
  captureCommand([process.execPath, cli, 'child', 'gamma', '--run', 'roadmap'], project);
  const gamma = readRun(project);
  parkRun(gamma, 'Complete the last independent child first');
  writeRun(gamma);
  captureCommand([process.execPath, cli, 'child', 'delta', '--run', 'roadmap'], project);
  await closeRoadmapChild(project, 'details.md', 'Delta correction\n', 'delta-reviewer');
  captureCommand([process.execPath, cli, 'child', 'gamma', '--run', 'roadmap'], project);
  await closeRoadmapChild(project, 'notes.md', 'Gamma correction\n', 'gamma-reviewer');
  captureCommand([process.execPath, cli, 'child', 'beta', '--run', 'roadmap'], project);
  await closeRoadmapChild(project, 'README.md', 'Beta correction\n', 'beta-reviewer');
  captureCommand([process.execPath, cli, 'child', 'alpha', '--run', 'roadmap'], project);
  const resumed = readRun(project);
  assert.equal(resumed.spec.id, 'alpha');
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.externalContributions![0]!.sourceRun, 'beta');
  assert.equal(readRun(project, 'beta').externalContributions![0]!.sourceRun, 'gamma');
});

function roadmapSpec() {
  const roadmap = spec('roadmap');
  roadmap.mode = 'roadmap';
  roadmap.children = [spec('alpha'), spec('beta')];
  roadmap.children[0]!.objective = 'First independent approved child';
  roadmap.children[1]!.objective = 'Second independent approved child';
  return roadmap;
}

function configureFileChild(child: ReturnType<typeof spec>, filename: string, contents: string): void {
  child.blocks[0]!.scope = [filename];
  child.checks[0]!.inputs = [filename];
  child.checks[0]!.command = [process.execPath, '-e', `require("node:assert/strict").equal(require("node:fs").readFileSync(${JSON.stringify(filename)}, "utf8"), ${JSON.stringify(contents)})`];
}

async function closeRoadmapChild(project: string, filename: string, contents: string, reviewer: string): Promise<void> {
  writeFileSync(path.join(project, filename), contents);
  const verification = await executeCheck(project, 'unit');
  assert.equal(verification.status, 'pass');
  const child = readRun(project);
  registerAgent(child, { id: reviewer, role: 'reviewer', tier: 'luna', scope: [filename] });
  finishAgent(child, reviewer, `Independent review covers the completed ${filename} correction and its executed assertion.`);
  recordReview(child, { agent: reviewer, kind: 'general', criteria: child.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(child);
  closeRun(child);
  writeRun(child);
  captureCommand(['git', 'add', filename], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', `reviewed ${child.spec.id}`], project);
}
