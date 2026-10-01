import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { startRun } from '../src/lifecycle.ts';
import { snapshot } from '../src/project.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('CLI validates recovery combinations before changing state and executes a native-authorized retry', context => {
  const project = fixture(context);
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, '-e', 'const fs=require("node:fs"); if(!fs.readFileSync("app.mjs","utf8").includes("repaired")){console.error("EROFS: read-only file system");process.exit(1)} console.log("PASS")'];
  approved(project, specification);
  assert.throws(() => captureCommand([process.execPath, cli, 'check', '--all'], project), /exit 2/);
  assert.match(readRun(project).next, /retry-permission/);
  const filename = path.join(project, '.oso-code-codex/runs/example.json');
  const before = readFileSync(filename, 'utf8');
  const invalid = [
    ['--retry', '--retry-permission', '--evidence', 'invalid'],
    ['--retry', '--all', '--evidence', 'invalid'],
    ['--retry-permission', '--red', '--evidence', 'invalid'],
    ['--retry-permission', '--measured', 'invalid', '--evidence', 'invalid'],
    ['--retry-permission', '--escalated', '--evidence', 'invalid'],
    ['--retry'],
  ];
  for (const args of invalid) {
    assert.throws(() => captureCommand([process.execPath, cli, 'check', 'unit', ...args], project));
    assert.equal(readFileSync(filename, 'utf8'), before);
  }
  writeFileSync(path.join(project, 'app.mjs'), 'export const repaired = true;');
  const result = JSON.parse(captureCommand([process.execPath, cli, 'check', 'unit', '--retry-permission', '--evidence', 'Synthetic approval for this invocation'], project));
  assert.equal(result.status, 'pass');
  assert.equal(readRun(project).blocks[0]!.rounds.length, 0);
  assert.equal(readRun(project).checks.length, 2);
});

test('CLI combined correction executes the repair and reuses its passing evidence', context => {
  const project = fixture(context);
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, '-e', 'if(!require("node:fs").readFileSync("app.mjs","utf8").includes("repaired"))process.exit(1)'];
  approved(project, specification);
  assert.throws(() => captureCommand([process.execPath, cli, 'check', 'unit'], project));
  writeFileSync(path.join(project, 'app.mjs'), 'export const repaired = true;');
  const result = JSON.parse(captureCommand([process.execPath, cli, 'check', 'unit', '--retry', '--evidence', 'Corrected behavior in fixture'], project));
  assert.equal(result.status, 'pass');
  assert.equal(JSON.parse(captureCommand([process.execPath, cli, 'check', '--all'], project)).attempt, result.attempt);
  assert.equal(readRun(project).blocks[0]!.rounds.length, 1);
});

test('an unborn Git branch starts without inventing a base commit', context => {
  const project = fixture(context);
  captureCommand(['git', 'symbolic-ref', 'HEAD', 'refs/heads/unborn'], project);
  const run = startRun(project, spec());
  assert.equal(run.baseHead, undefined);
  assert.equal(run.status, 'pending-approval');
});

test('one explicit semantic review closes quick only after the existing checks and independence gates', context => {
  const project = fixture(context);
  assert.equal(JSON.parse(captureCommand([process.execPath, cli, 'status'], project)).status, 'not-started');
  approved(project);
  const report = path.join(project, '.oso-code-codex/report.md');
  writeFileSync(report, 'Independent inspection: pricing, the rubric and frozen conformance are satisfied.');
  const command = [process.execPath, cli, 'review', '--agent', 'actual-independent-fixture', '--report', report, '--verdict', 'pass', '--all-criteria', '--finish'];
  assert.throws(() => captureCommand(command, project), /required check/);
  captureCommand([process.execPath, cli, 'check', '--all'], project);
  captureCommand(command, project);
  const run = readRun(project);
  assert.equal(run.status, 'closed');
  assert.equal(run.checks.length, 1);
  assert.equal(run.agents.length, 1);
  assert.equal(run.finalReviews.length, 0);
});

test('pre-release root run records resume with their evidence and migrate on the next write', context => {
  const project = fixture(context);
  const run = approved(project);
  renameSync(path.join(project, '.oso-code-codex/runs/example.json'), path.join(project, '.oso-code-codex/example.json'));
  const recovered = readRun(project);
  assert.deepEqual(recovered, run);
  writeRun(recovered);
  assert.equal(readRun(project).specDigest, run.specDigest);
});

test('final in a quick workflow means its combined review and retains every block criterion', context => {
  const project = fixture(context);
  approved(project);
  const directory = path.join(project, '.oso-code-codex');
  const assignment = path.join(directory, 'assignment.json');
  const report = path.join(directory, 'report.md');
  writeFileSync(assignment, JSON.stringify({ id: 'independent-final', role: 'reviewer', tier: 'luna', scope: ['app.mjs'] }));
  writeFileSync(report, 'Independent rubric, conformance and pricing inspection passed.');
  captureCommand([process.execPath, cli, 'agent', '--file', assignment, '--final'], project);
  const command = [process.execPath, cli, 'review', '--agent', 'independent-final', '--report', report, '--verdict', 'pass', '--all-criteria', '--final', '--finish'];
  assert.throws(() => captureCommand(command, project), /required check/);
  captureCommand([process.execPath, cli, 'check', '--all'], project);
  captureCommand(command, project);
  const run = readRun(project);
  assert.equal(run.status, 'closed');
  assert.equal(run.agents[0]!.block, run.blocks[0]!.id);
  assert.deepEqual(run.blocks[0]!.reviews[0]!.criteria, run.spec.blocks[0]!.criteria);
  assert.equal(run.finalReviews.length, 0);
});

test('the child command activates exact stored authority and resumes without resetting state', context => {
  const project = fixture(context);
  const parent = spec('roadmap');
  parent.mode = 'roadmap';
  parent.children = [spec('child')];
  approved(project, parent);
  captureCommand([process.execPath, cli, 'child', 'child'], project);
  const child = readRun(project);
  assert.equal(child.approval!.kind, 'roadmap');
  assert.equal(child.activeBlock, 'price');
  captureCommand([process.execPath, cli, 'child', 'child', '--run', 'roadmap'], project);
  assert.equal(readRun(project).created, child.created);
  assert.equal(readRun(project).specDigest, child.specDigest);
  const completed = readRun(project);
  completed.status = 'closed';
  writeRun(completed);
  captureCommand([process.execPath, cli, 'child', 'child', '--run', 'roadmap'], project);
  assert.equal(readRun(project).spec.id, 'roadmap');
});

test('red reproduction keeps non-success CLI semantics and an unexpected pass cannot become green', context => {
  for (const exitCode of [0, 1]) {
    const project = fixture(context);
    const specification = spec();
    specification.checks[0]!.command = [process.execPath, '-e', `process.exit(${exitCode})`];
    approved(project, specification);
    assert.throws(() => captureCommand([process.execPath, cli, 'check', 'unit', '--red'], project));
    const run = readRun(project);
    assert.equal(run.checks[0]!.exitCode, exitCode);
    assert.equal(run.checks[0]!.status, exitCode === 0 ? 'blocked' : 'reproduced');
    assert.equal(run.blocks[0]!.failure?.kind, exitCode === 0 ? 'delivery' : undefined);
    assert.equal(run.blocks[0]!.rounds.length, 0);
  }
});

test('stdin starts and reviews an authorized run without operational Markdown or relaxed evidence', context => {
  const project = fixture(context);
  const input = JSON.stringify({ specification: spec(), authorization: { kind: 'user', reference: 'actual-fixture-request', message: 'Implement this fixture plan.' } });
  fromStdin(project, ['start', '--file', '-', '--authorization', '-'], input);
  assert.equal(readRun(project).activeBlock, 'price');
  const report = 'Independent inspection covers rubric, conformance and the price contract.';
  const review = ['review', '--agent', 'independent-stdin', '--report', '-', '--verdict', 'pass', '--all-criteria', '--finish'];
  assert.throws(() => fromStdin(project, review, report), /required check/);
  captureCommand([process.execPath, cli, 'check', '--all'], project);
  fromStdin(project, review, report);
  const run = readRun(project);
  assert.equal(run.status, 'closed');
  assert.equal(run.agents[0]!.result, report);
  assert.equal(run.checks.length, 1);
  assert.ok(readdirSync(path.join(project, '.oso-code-codex/reviews/example')).every(name => name.endsWith('.txt')));
  assert.equal(captureCommand(['git', 'status', '--porcelain'], project), '');
});

test('stdin preserves actual authorization checks and the pending run on missing user evidence', context => {
  const project = fixture(context);
  assert.throws(() => fromStdin(project, ['start', '--file', '-', '--authorization', '-'], JSON.stringify({ specification: spec(), authorization: { kind: 'user', reference: 'fixture' } })), /actual message/);
  assert.equal(readRun(project).status, 'pending-approval');
  fromStdin(project, ['authorize', '--file', '-'], JSON.stringify({ kind: 'user', reference: 'actual-fixture-request', message: 'Implement the fixture.' }));
  captureCommand([process.execPath, cli, 'activate', 'price'], project);
  const report = 'The implementation author cannot independently approve their own work.';
  assert.throws(() => fromStdin(project, ['review', '--agent', 'native-parent', '--report', '-', '--verdict', 'pass', '--all-criteria'], report), /native child/);
  assert.equal(readRun(project).blocks[0]!.reviews.length, 0);
});

function fromStdin(project: string, args: string[], content: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'oso-code-codex-stdin-'));
  const filename = path.join(directory, 'input');
  writeFileSync(filename, content);
  try { return captureCommand(['bash', '-c', 'exec "$@" < "$0"', filename, process.execPath, cli, ...args], project); }
  finally { rmSync(directory, { recursive: true }); }
}

test('stdin adoption records exact authorized preserved content without promoting evidence', context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 10;\n');
  const run = approved(project);
  const document = { files: snapshot(project, ['app.mjs']), authorization: { kind: 'user', reference: 'native-adoption', message: 'Adopt this preserved implementation.' } };
  fromStdin(project, ['adopt', '--file', '-', '--authorization', '-'], JSON.stringify(document));
  const adopted = readRun(project);
  assert.deepEqual(adopted.baseline, run.baseline);
  assert.equal(adopted.adoptions![0]!.authorization.specDigest, run.specDigest);
  assert.equal(adopted.adoptions![0]!.authorization.message, document.authorization.message);
  assert.deepEqual(adopted.adoptions![0]!.files, document.files);
  assert.deepEqual(adopted.checks, []);
  assert.equal(adopted.blocks[0]!.status, 'active');
});
