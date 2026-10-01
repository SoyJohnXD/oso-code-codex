import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classifyOutput, executeCheck, validCheck } from '../src/checks.ts';
import { recordFailure, retry } from '../src/recovery.ts';
import { recordRecoveryStrategy, recoveryStatus } from '../src/recovery-control.ts';
import { acquireLock, readRun, stateDirectory, writeRun } from '../src/store.ts';
import { digest } from '../src/project.ts';
import { parseSpec } from '../src/schema.ts';
import { approved, fixture, spec } from './support.ts';

const correction = { kind: 'correction' as const, evidence: 'Repaired fixture input' };
const permission = { kind: 'permission' as const, evidence: 'Synthetic native approval of this exact check invocation' };

function failingProject(context: test.TestContext, output: string): string {
  const project = fixture(context);
  writeFileSync(path.join(project, 'check.mjs'), 'import { readFileSync } from "node:fs"; const value = readFileSync("app.mjs", "utf8"); if (!value.includes("repaired")) { console.error(' + JSON.stringify(output) + '); process.exit(1); } console.log("PASS");\n');
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, 'check.mjs'];
  specification.checks[0]!.inputs.push('check.mjs');
  approved(project, specification);
  return project;
}

function repair(project: string): void {
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 5; export const repaired = true;\n');
}

test('correction and affected check execute together and spend exactly one round', async context => {
  const project = failingProject(context, 'AssertionError: expected revised behavior');
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  repair(project);
  const result = await executeCheck(project, 'unit', false, correction);
  assert.equal(result.status, 'pass');
  const run = readRun(project);
  assert.equal(run.blocks[0]!.rounds.length, 1);
  assert.equal(run.blocks[0]!.failure, undefined);
  assert.equal(run.checks.length, 2);
  assert.equal((await executeCheck(project, 'unit')).attempt, result.attempt);
});

test('permission recovery is one separate attempt and survives resume or changed wording', async context => {
  const project = failingProject(context, 'Error: EACCES: permission denied, open /restricted/service');
  const first = await executeCheck(project, 'unit');
  assert.equal(first.blocker, 'permission');
  const second = await executeCheck(project, 'unit', false, permission);
  assert.equal(second.status, 'blocked');
  assert.equal(second.permissionEpisode, first.attempt);
  const before = readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8');
  await assert.rejects(executeCheck(project, 'unit', false, { ...permission, evidence: 'Different text and agent' }), /already attempted/);
  assert.equal(readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8'), before);
  assert.equal(readRun(project).blocks[0]!.rounds.length, 0);
});

test('permission success preserves correction budget and resolves only its episode', async context => {
  const project = failingProject(context, 'EROFS: read-only file system, open /restricted/cache');
  await executeCheck(project, 'unit');
  repair(project);
  assert.equal((await executeCheck(project, 'unit', false, permission)).status, 'pass');
  assert.equal(readRun(project).blocks[0]!.rounds.length, 0);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  const next = await executeCheck(project, 'unit');
  assert.equal(next.permissionEpisode, next.attempt);
  assert.notEqual(next.permissionEpisode, readRun(project).checks[0]!.permissionEpisode);
});

test('an access failure requires fresh execution even when an older passing fingerprint matches again', async context => {
  const project = fixture(context);
  const original = readFileSync(path.join(project, 'app.mjs'), 'utf8');
  writeFileSync(path.join(project, 'access.mjs'), 'import { existsSync } from "node:fs"; if(existsSync(".oso-code-codex/denied")){console.error("EACCES: permission denied");process.exit(1)} console.log("PASS");');
  const specification = spec();
  specification.checks[0]!.command = [process.execPath, 'access.mjs'];
  specification.checks[0]!.inputs.push('access.mjs');
  approved(project, specification);
  const first = await executeCheck(project, 'unit');
  writeFileSync(path.join(project, '.oso-code-codex/denied'), 'synthetic external access policy');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;');
  const failure = await executeCheck(project, 'unit');
  writeFileSync(path.join(project, 'app.mjs'), original);
  assert.equal(validCheck(readRun(project), 'unit'), undefined);
  const recovered = await executeCheck(project, 'unit', false, permission);
  assert.equal(recovered.fingerprint, first.fingerprint);
  assert.equal(recovered.status, 'blocked');
  assert.notEqual(recovered.attempt, first.attempt);
  assert.equal(recovered.permissionEpisode, failure.attempt);
  assert.equal(readRun(project).checks.length, 3);
  unlinkSync(path.join(project, '.oso-code-codex/denied'));
  const repaired = await executeCheck(project, 'unit', false, { ...correction, measured: 'Removed the synthetic external denial policy' });
  assert.equal(repaired.status, 'pass');
  assert.equal((await executeCheck(project, 'unit')).attempt, repaired.attempt);
});

test('permission recovery cannot relabel application, timeout or manual failures', async context => {
  const project = failingProject(context, 'AssertionError: regression');
  await executeCheck(project, 'unit');
  await assert.rejects(executeCheck(project, 'unit', false, permission), /permission/);
  const run = readRun(project);
  recordFailure(run, 'infrastructure', 'Permission was mentioned in a narrative');
  writeRun(run);
  await assert.rejects(executeCheck(project, 'unit', false, permission), /permission/);
  assert.equal(run.blocks[0]!.rounds.length, 0);
  assert.equal(classifyOutput('EPERM', { code: null, timeout: true }).blocker, 'environment');
});

test('classification distinguishes access errors from mentions, missing commands and product failures', () => {
  assert.equal(classifyOutput('EROFS: read-only file system', { code: 1 }).blocker, 'permission');
  assert.equal(classifyOutput('Error: EPERM: operation not permitted, spawn tool', { code: 1 }).blocker, 'permission');
  assert.equal(classifyOutput('test title: handles EPERM\nAssertionError: expected 2', { code: 1 }).blocker, undefined);
  assert.equal(classifyOutput('test EACCES: permission denied passed', { code: 0 }).status, 'pass');
  assert.equal(classifyOutput('ENOENT: command not found', { code: 1 }).blocker, 'environment');
  assert.equal(classifyOutput('fatal: could not create lock file: Permission denied', { code: 128 }).blocker, 'permission');
  assert.equal(classifyOutput('/bin/sh: 1: cannot create build/out: Permission denied', { code: 2 }).blocker, 'permission');
  assert.equal(classifyOutput('test title: handles EACCES: permission denied\nAssertionError: expected 2', { code: 1 }).blocker, undefined);
});

test('invalid scope, live resources and failed log preparation do not consume correction', async context => {
  const project = failingProject(context, 'AssertionError: regression');
  await executeCheck(project, 'unit');
  repair(project);
  const filename = path.join(stateDirectory(project), 'runs/example.json');
  const before = readFileSync(filename, 'utf8');
  await assert.rejects(executeCheck(project, 'foreign', false, correction), /approved verification bar/);
  assert.equal(readFileSync(filename, 'utf8'), before);
  const release = acquireLock(path.join(stateDirectory(project), 'locks', digest('project-bar')));
  try { await assert.rejects(executeCheck(project, 'unit', false, correction), /busy/); } finally { release(); }
  assert.equal(readFileSync(filename, 'utf8'), before);
  const run = readRun(project);
  run.spec.id = 'log-fault';
  writeRun(run);
  writeFileSync(path.join(stateDirectory(project), 'active'), 'log-fault\n');
  run.approval = { kind: 'user', reference: 'fixture', message: 'approved log preparation fixture', specDigest: digest(JSON.stringify(run.spec)) };
  run.specDigest = run.approval.specDigest;
  writeRun(run);
  mkdirSync(path.join(stateDirectory(project), 'logs'), { recursive: true });
  writeFileSync(path.join(stateDirectory(project), 'logs/log-fault'), 'not a directory');
  const faultFile = path.join(stateDirectory(project), 'runs/log-fault.json');
  const beforeFault = readFileSync(faultFile, 'utf8');
  await assert.rejects(executeCheck(project, 'unit', false, correction), /EEXIST|ENOTDIR/);
  assert.equal(readFileSync(faultFile, 'utf8'), beforeFault);
});

test('permission episodes survive a standalone correction and cannot be renewed by it', async context => {
  const project = failingProject(context, 'EACCES: permission denied');
  const first = await executeCheck(project, 'unit');
  await executeCheck(project, 'unit', false, permission);
  const run = readRun(project);
  retry(run, 'Measured actual service repair in fixture', false, 'Service configuration revised');
  writeRun(run);
  const third = await executeCheck(project, 'unit');
  assert.equal(third.permissionEpisode, first.attempt);
  await assert.rejects(executeCheck(project, 'unit', false, permission), /already attempted/);
  assert.equal(readRun(project).blocks[0]!.rounds.length, 1);
});

test('legacy records without linked access evidence do not acquire invented permission grants', async context => {
  const project = failingProject(context, 'EACCES: permission denied');
  await executeCheck(project, 'unit');
  const run = readRun(project);
  delete run.blocks[0]!.failure!.checkAttempt;
  writeRun(run);
  await assert.rejects(executeCheck(project, 'unit', false, permission), /permission/);
  repair(project);
  assert.equal((await executeCheck(project, 'unit', false, correction)).status, 'pass');
});

test('independent checks avoid service setup and changed wrappers invalidate only their dependents', async context => {
  const project = fixture(context);
  const count = 'import { appendFileSync } from "node:fs";';
  writeFileSync(path.join(project, 'local.mjs'), count + ' appendFileSync(".oso-code-codex/local-count", "1"); console.log("PASS");');
  writeFileSync(path.join(project, 'service.mjs'), 'if (process.env.OSO_FIXTURE_SERVICE !== "ready") throw new Error("Service setup required"); console.log("PASS");');
  const preparation = count + ' appendFileSync(".oso-code-codex/service-count", "1"); process.env.OSO_FIXTURE_SERVICE="ready"; await import("./service.mjs");';
  writeFileSync(path.join(project, 'prepare.mjs'), preparation);
  const specification = spec();
  specification.checks = [
    { id: 'invoice', command: [process.execPath, 'local.mjs'], inputs: ['local.mjs', 'app.mjs'], resources: [], envKeys: [] },
    { id: 'shape', command: [process.execPath, 'prepare.mjs'], inputs: ['service.mjs', 'prepare.mjs'], resources: ['fixture-service'] },
  ];
  specification.blocks[0]!.checks = ['invoice', 'shape'];
  approved(project, specification);
  const local = await executeCheck(project, 'invoice');
  assert.equal(local.status, 'pass');
  assert.equal(existsSync(path.join(project, '.oso-code-codex/service-count')), false);
  const service = await executeCheck(project, 'shape');
  assert.equal(service.status, 'pass');
  assert.equal((await executeCheck(project, 'shape')).attempt, service.attempt);
  writeFileSync(path.join(project, 'prepare.mjs'), preparation + '\nexport const revision = 2;');
  assert.notEqual((await executeCheck(project, 'shape')).attempt, service.attempt);
  assert.equal((await executeCheck(project, 'invoice')).attempt, local.attempt);
  assert.equal(readFileSync(path.join(project, '.oso-code-codex/local-count'), 'utf8'), '1');
  assert.equal(readFileSync(path.join(project, '.oso-code-codex/service-count'), 'utf8'), '11');
});

test('optional empty check dependencies need no invented resources or environment keys', () => {
  const specification = spec();
  specification.checks[0]!.resources = [];
  specification.checks[0]!.envKeys = [];
  assert.doesNotThrow(() => parseSpec(specification));
  for (const key of ['resources', 'envKeys'] as const) {
    specification.checks[0]![key] = [''];
    assert.throws(() => parseSpec(specification), /nonempty text/);
    specification.checks[0]![key] = ['duplicate', 'duplicate'];
    assert.throws(() => parseSpec(specification), /duplicates/);
    specification.checks[0]![key] = [];
  }
});

test('combined recovery preserves an exhausted budget and does not start another check', async context => {
  const project = failingProject(context, 'AssertionError: regression');
  await executeCheck(project, 'unit');
  for (let round = 0; round < 3; round++) {
    if (round === 2) {
      const run = readRun(project);
      recordRecoveryStrategy(run, { block: run.activeBlock, failureKey: recoveryStatus(run).failureKey, diagnosis: { agent: run.spec.principal, report: 'The recorded assertion still fails after two numeric-only revisions; the check requires an explicit repaired export.', evidence: [run.checks.at(-1)!.log] }, approach: 'Inspect the exported fixture contract and add the repaired marker.' });
      writeRun(run);
    }
    writeFileSync(path.join(project, 'app.mjs'), `export const price = ${round};`);
    assert.equal((await executeCheck(project, 'unit', false, { ...correction, escalated: round === 2 })).status, 'fail');
  }
  repair(project);
  const before = readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8');
  await assert.rejects(executeCheck(project, 'unit', false, { ...correction, escalated: true }), /budget exhausted/);
  await assert.rejects(executeCheck(project, 'unit', false, permission), /permission failure/);
  assert.equal(readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8'), before);
  assert.equal(readRun(project).checks.length, 4);
});

test('tampered access logs, missing approval evidence and active executors preserve blocked state', async context => {
  const project = failingProject(context, 'Error: EACCES: permission denied');
  const failed = await executeCheck(project, 'unit');
  await assert.rejects(executeCheck(project, 'unit', false, { ...permission, evidence: '' }), /actual native authorization/);
  writeFileSync(failed.log, 'changed failure evidence');
  const before = readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8');
  await assert.rejects(executeCheck(project, 'unit', false, permission), /intact recorded failure log/);
  assert.equal(readFileSync(path.join(stateDirectory(project), 'runs/example.json'), 'utf8'), before);
  const run = readRun(project);
  run.checks.push({ ...failed, attempt: 'live-fixture', status: 'running' });
  writeRun(run);
  await assert.rejects(executeCheck(project, 'unit', false, permission), /executor is still running/);
  assert.equal(readRun(project).blocks[0]!.permissionEpisodes!.unit!.recovery, undefined);
});
