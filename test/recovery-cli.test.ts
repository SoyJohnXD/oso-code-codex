import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { approved, fixture } from './support.ts';

test('recovery status is read-only and a repeated authorized grant cannot multiply its budget', context => {
  const project = fixture(context);
  approved(project);
  const record = path.join(project, '.oso-code-codex/runs/example.json');
  const before = readFileSync(record, 'utf8');
  const budget = JSON.parse(captureCommand([process.execPath, path.resolve('src/cli.ts'), 'recovery', 'status'], project));
  assert.equal(budget.owner, 'example');
  assert.equal(budget.used, 0);
  assert.equal(readFileSync(record, 'utf8'), before);
  const payload = {
    owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, additionalCorrections: 4,
    authorization: { kind: 'user', message: 'Continue this fixture with four additional corrections', reference: 'fixture-session/2026-09-15T01:00:00Z', specDigest: budget.specDigest },
  };
  const document = path.join(project, '.oso-code-codex/grant.json');
  writeFileSync(document, JSON.stringify(payload));
  const command = [process.execPath, path.resolve('src/cli.ts'), 'recovery', 'authorize', '--file', document];
  const granted = JSON.parse(captureCommand(command, project));
  assert.equal(granted.remaining, 4);
  assert.equal(JSON.parse(captureCommand(command, project)).remaining, 4);
  payload.additionalCorrections = 5;
  writeFileSync(document, JSON.stringify(payload));
  assert.throws(() => captureCommand(command, project), /reused|different|already|reference/i);
  const after = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(after.version, 3);
  assert.equal(after.recovery.grants.length, 1);
  assert.deepEqual(after.baseline, JSON.parse(before).baseline);
});
