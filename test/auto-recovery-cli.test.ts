import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { executeCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { readRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

test('CLI starts explicit AUTO and leaves unadopted legacy execution writable', context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { mode: 'auto' };
  const document = path.join(project, 'approval.json');
  writeFileSync(document, JSON.stringify({
    specification,
    authorization: { kind: 'user', reference: 'fixture/start-auto', message: 'Implement this isolated AUTO fixture' },
  }));
  const started = JSON.parse(invoke(project, 'start', '--file', document, '--authorization', document));
  assert.equal(started.recovery.policy.mode, 'auto');
  assert.equal(started.recovery.policySource, 'spec');
  assert.equal(started.recovery.limit, undefined);
  assert.equal(readRun(project).version, 4);
  assert.equal(readRun(project).readerMinimumVersion, 4);

  const legacyProject = fixture(context);
  const legacy = spec();
  legacy.recovery = { maxCorrections: 2 };
  approved(legacyProject, legacy);
  const record = path.join(legacyProject, '.oso-code-codex/runs/example.json');
  const before = readFileSync(record, 'utf8');
  assert.equal(JSON.parse(invoke(legacyProject, 'recovery', 'status')).limit, 2);
  assert.equal(readFileSync(record, 'utf8'), before);
  invoke(legacyProject, 'note', '--next', 'Continue the existing bounded fixture');
  assert.equal(readRun(legacyProject).version, 3);
  assert.equal(readRun(legacyProject).next, 'Continue the existing bounded fixture');
});

test('CLI adoption preserves an exhausted failure and cannot replay away a later hard ceiling', async context => {
  const project = fixture(context);
  const specification = spec();
  specification.recovery = { maxCorrections: 1 };
  specification.checks[0]!.command = [process.execPath, '-e', 'import("./app.mjs").then(({price})=>{if(price!==6)throw new Error("Expected price 6")})'];
  approved(project, specification);
  assert.equal((await executeCheck(project, 'unit')).status, 'fail');
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  assert.equal((await executeCheck(project, 'unit', false, { kind: 'correction', evidence: 'First recorded fixture correction failed its assertion' })).status, 'fail');
  const record = path.join(project, '.oso-code-codex/runs/example.json');
  const retained = readRun(project);
  const status = JSON.parse(invoke(project, 'recovery', 'status'));
  assert.equal(status.pause.kind, 'budget');
  const adoption = {
    owner: status.owner, specDigest: status.specDigest, revision: status.revision,
    policy: { mode: 'auto' },
    authorization: { kind: 'user', reference: 'fixture/adopt-auto', message: 'Replace this fixture round ceiling with progress-based AUTO', specDigest: status.specDigest },
  };
  const document = path.join(project, '.oso-code-codex/adoption.json');
  writeFileSync(document, JSON.stringify(adoption));
  const adopted = JSON.parse(invoke(project, 'recovery', 'adopt', '--file', document));
  assert.equal(adopted.policySource, 'adoption');
  assert.equal(adopted.limit, undefined);
  assert.equal(adopted.used, 1);
  const current = readRun(project);
  assert.equal(current.version, 4);
  assert.deepEqual(current.spec, retained.spec);
  assert.deepEqual(current.approval, retained.approval);
  assert.deepEqual(current.baseline, retained.baseline);
  assert.deepEqual(current.blocks[0]!.rounds, retained.blocks[0]!.rounds);
  assert.deepEqual(current.blocks[0]!.failure, retained.blocks[0]!.failure);
  assert.deepEqual(current.checks, retained.checks);
  assert.throws(() => invoke(project, 'checkpoint'));

  const cappedDocument = path.join(project, '.oso-code-codex/later-limit.json');
  const ceiling = {
    ...adoption, revision: adopted.revision, policy: { mode: 'auto', maxCorrections: 1 },
    authorization: { ...adoption.authorization, reference: 'fixture/later-hard-limit', message: 'Set a later hard ceiling of one total correction for this fixture' },
  };
  writeFileSync(cappedDocument, JSON.stringify(ceiling));
  const capped = JSON.parse(invoke(project, 'recovery', 'adopt', '--file', cappedDocument));
  assert.equal(capped.limit, 1);
  assert.equal(capped.remaining, 0);
  assert.equal(capped.pause.kind, 'budget');
  const beforeReplay = readFileSync(record, 'utf8');
  writeFileSync(cappedDocument, JSON.stringify({ ...ceiling, policy: { maxCorrections: 1, mode: 'auto' } }));
  assert.equal(JSON.parse(invoke(project, 'recovery', 'adopt', '--file', cappedDocument)).limit, 1);
  assert.equal(readFileSync(record, 'utf8'), beforeReplay);
  const replay = JSON.parse(invoke(project, 'recovery', 'adopt', '--file', document));
  assert.equal(replay.limit, 1);
  assert.equal(readFileSync(record, 'utf8'), beforeReplay);

  writeFileSync(document, JSON.stringify({ ...adoption, policy: { mode: 'auto', maxCorrections: 3 } }));
  assert.throws(() => invoke(project, 'recovery', 'adopt', '--file', document), /reference|already|different|conflict/i);
  assert.equal(readFileSync(record, 'utf8'), beforeReplay);
  writeFileSync(document, JSON.stringify({
    ...adoption, authorization: { ...adoption.authorization, reference: 'fixture/new-reference-stale-position' },
  }));
  assert.throws(() => invoke(project, 'recovery', 'adopt', '--file', document), /stale|revision/i);
  assert.equal(readFileSync(record, 'utf8'), beforeReplay);
});

test('CLI rejects malformed AUTO adoption without changing the selected legacy record', context => {
  const project = fixture(context);
  approved(project);
  const status = JSON.parse(invoke(project, 'recovery', 'status'));
  const record = path.join(project, '.oso-code-codex/runs/example.json');
  const before = readFileSync(record, 'utf8');
  const adoption = {
    owner: status.owner, specDigest: status.specDigest, revision: status.revision,
    policy: { mode: 'auto' },
    authorization: { kind: 'user', reference: 'fixture/rejected-adoption', message: 'Adopt AUTO in this fixture', specDigest: status.specDigest },
  };
  const invalid = [
    { ...adoption, policy: { mode: 'auto', maxCorrections: 0 } },
    { ...adoption, policy: { mode: 'auto', unknown: true } },
    { ...adoption, owner: 'another-owner' },
    { ...adoption, authorization: { ...adoption.authorization, message: '' } },
    { ...adoption, authorization: { ...adoption.authorization, specDigest: '0'.repeat(64) } },
  ];
  const document = path.join(project, '.oso-code-codex/rejected-adoption.json');
  for (const payload of invalid) {
    writeFileSync(document, JSON.stringify(payload));
    assert.throws(() => invoke(project, 'recovery', 'adopt', '--file', document));
    assert.equal(readFileSync(record, 'utf8'), before);
  }
});

function invoke(project: string, ...arguments_: string[]): string {
  return captureCommand([process.execPath, path.resolve('src/cli.ts'), ...arguments_], project);
}
