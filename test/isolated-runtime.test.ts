import assert from 'node:assert/strict';
import fs from 'node:fs';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { startIsolatedRun } from '../src/isolated.ts';
import { parkRun } from '../src/parking.ts';
import { readRun, writeRun } from '../src/store.ts';
import { approved, fixture, spec } from './support.ts';

test('isolated start records both sides before selecting the successor', context => {
  const source = fixture(context);
  const original = approved(source);
  writeFileSync(path.join(source, 'app.mjs'), 'export const price = 6;\n');
  captureCommand(['git', 'add', 'app.mjs'], source);
  writeFileSync(path.join(source, 'app.mjs'), 'export const price = 7;\n');
  parkRun(original, 'Independent documentation work');
  writeRun(original);
  const isolated = path.join(source, '.oso-code-codex/worktrees/docs');
  captureCommand(['git', 'worktree', 'add', '-q', '-b', 'docs', isolated, 'HEAD'], source);
  const correction = spec('docs');
  correction.objective = 'Independent documentation correction';
  correction.blocks[0]!.scope = ['README.md'];
  const next = startIsolatedRun(isolated, source, original.spec.id, correction);
  assert.equal(next.link!.crossProject!.sourceProject, source);
  assert.equal(readRun(source).isolatedSuccessors![0]!.run, 'docs');
  assert.equal(readRun(source).status, 'parked');
  assert.equal(readRun(isolated).spec.id, 'docs');
});

test('an interrupted initial isolated write retains its complete source link for same-id recovery', context => {
  const source = fixture(context);
  const original = approved(source);
  parkRun(original, 'Independent documentation work');
  writeRun(original);
  const isolated = path.join(source, '.oso-code-codex/worktrees/retry-docs');
  captureCommand(['git', 'worktree', 'add', '-q', '-b', 'retry-docs', isolated, 'HEAD'], source);
  const correction = spec('retry-docs');
  correction.objective = 'Independent documentation correction';
  correction.blocks[0]!.scope = ['README.md'];
  const originalRename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = ((temporary: fs.PathLike, target: fs.PathLike) => {
    if (!interrupted && String(target) === path.join(isolated, '.oso-code-codex/runs/retry-docs.json')) {
      interrupted = true;
      originalRename(temporary, target);
      throw new Error('Synthetic initial isolated write interruption');
    }
    originalRename(temporary, target);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try {
    assert.throws(() => startIsolatedRun(isolated, source, original.spec.id, correction), /Synthetic initial isolated write interruption/);
    assert.equal(readRun(isolated, 'retry-docs').link!.crossProject!.sourceRun, original.spec.id);
    const recovered = startIsolatedRun(isolated, source, original.spec.id, correction);
    assert.equal(recovered.spec.id, 'retry-docs');
    assert.equal(readRun(source).isolatedSuccessors![0]!.status, 'active');
  } finally {
    fs.renameSync = originalRename;
    syncBuiltinESMExports();
  }
});

test('a failed atomic run replacement retains the prior record until a compatible reader retries', context => {
  const project = fixture(context);
  const run = approved(project);
  const prior = readRun(project);
  const target = path.join(project, '.oso-code-codex/runs/example.json');
  const originalRename = fs.renameSync;
  let interrupted = false;
  fs.renameSync = ((temporary: fs.PathLike, filename: fs.PathLike) => {
    if (!interrupted && String(filename) === target) {
      interrupted = true;
      throw new Error('Synthetic atomic rename interruption');
    }
    originalRename(temporary, filename);
  }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try {
    run.next = 'Persist the retry after the interrupted atomic replacement.';
    assert.throws(() => writeRun(run), /Synthetic atomic rename interruption/);
    assert.equal(readRun(project).next, prior.next);
  } finally {
    fs.renameSync = originalRename;
    syncBuiltinESMExports();
  }
  writeRun(run);
  assert.equal(readRun(project).next, run.next);
});
