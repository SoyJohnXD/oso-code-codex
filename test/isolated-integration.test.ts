import assert from 'node:assert/strict';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { acquireLock, readRun } from '../src/store.ts';
import { integrateIsolatedRun, namedResourceLockDirectory } from '../src/isolated.ts';
import { executeCheck } from '../src/checks.ts';
import { digest } from '../src/project.ts';
import { approved, closeDocumentationCorrection, fixture, spec } from './support.ts';

const cli = path.resolve('src/cli.ts');

test('dirty A can link an approved isolated B without changing A bytes or its index', context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  const before = captureCommand(['git', 'diff', '--cached', '--binary'], project);
  const isolated = startIsolatedDocumentation(project);
  assert.equal(readRun(isolated).link?.parkedRun, 'example');
  assert.equal(readRun(project).status, 'parked');
  assert.equal(captureCommand(['git', 'diff', '--cached', '--binary'], project), before);
  assert.equal(readFileSync(path.join(project, 'app.mjs'), 'utf8'), 'export const price = 7;\n');
});

test('integrating reviewed B preserves staged and unstaged A work through a fast-forward', async context => {
  const project = fixture(context);
  approved(project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
  captureCommand(['git', 'add', 'app.mjs'], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 7;\n');
  const before = captureCommand(['git', 'diff', '--cached', '--binary'], project);
  const isolated = startIsolatedDocumentation(project);
  await closeDocumentationCorrection(isolated);
  const head = captureCommand(['git', 'rev-parse', 'HEAD'], isolated);
  captureCommand([process.execPath, cli, 'integrate', '--from-run', 'documentation', '--from-project', isolated], project);
  assert.equal(captureCommand(['git', 'rev-parse', 'HEAD'], project), head);
  assert.equal(captureCommand(['git', 'diff', '--cached', '--binary'], project), before);
  assert.equal(readFileSync(path.join(project, 'app.mjs'), 'utf8'), 'export const price = 7;\n');
  assert.equal(readFileSync(path.join(project, 'README.md'), 'utf8'), 'Corrected documentation\n');
  captureCommand([process.execPath, cli, 'resume', '--run', 'example'], project);
  assert.equal(readRun(project).status, 'running');
  assert.equal(readRun(project).externalContributions?.[0]?.sourceRun, 'documentation');
});

test('an overlap leaves B complete and A unchanged with integration pending', async context => {
  const project = fixture(context);
  writeFileSync(path.join(project, 'README.md'), 'Preserved partial user documentation\n');
  approved(project);
  const originalHead = captureCommand(['git', 'rev-parse', 'HEAD'], project);
  const originalIndex = captureCommand(['git', 'diff', '--cached', '--binary'], project);
  const isolated = startIsolatedDocumentation(project);
  await closeDocumentationCorrection(isolated);
  try { captureCommand([process.execPath, cli, 'integrate', '--from-run', 'documentation', '--from-project', isolated], project); }
  catch (error) { assert.match(String(error), /overlap|pending|conflict|collision/i); }
  assert.equal(captureCommand(['git', 'rev-parse', 'HEAD'], project), originalHead);
  assert.equal(captureCommand(['git', 'diff', '--cached', '--binary'], project), originalIndex);
  assert.equal(readFileSync(path.join(project, 'README.md'), 'utf8'), 'Preserved partial user documentation\n');
  assert.equal(readRun(isolated).status, 'closed');
  captureCommand([process.execPath, cli, 'resume', '--run', 'example'], project);
  assert.equal(readRun(project).status, 'running');
  assert.equal(readRun(project).externalContributions?.length ?? 0, 0);
});

test('a named resource held by A prevents B from launching its check', async context => {
  const project = fixture(context);
  approved(project);
  const isolated = startIsolatedDocumentation(project);
  const release = acquireLock(path.join(namedResourceLockDirectory(readRun(project))!, digest('documentation-resource')));
  try {
    await assert.rejects(executeCheck(isolated, 'unit'), /Resource is busy/);
    assert.equal(readRun(isolated).checks.length, 0);
  } finally { release(); }
  await closeDocumentationCorrection(isolated);
  assert.equal(readRun(isolated).checks.at(-1)!.status, 'pass');
});

for (const boundary of ['after-intent', 'before-finalize', 'diverged-after-intent']) {
  test(`integration recovers ${boundary} without replaying completed Git work`, async context => {
    const project = fixture(context);
    approved(project);
    writeFileSync(path.join(project, 'app.mjs'), 'export const price = 6;\n');
    const isolated = startIsolatedDocumentation(project);
    await closeDocumentationCorrection(isolated);
    const originalRename = fs.renameSync;
    const originalSpawn = childProcess.spawnSync;
    let interrupted = false;
    let merges = 0;
    fs.renameSync = (source, target) => {
      if (String(target) === path.join(project, '.oso-code-codex/runs/example.json') && !interrupted) {
        const next = JSON.parse(readFileSync(source, 'utf8'));
        const inject = boundary !== 'before-finalize' ? Boolean(next.integrationIntent) : !next.integrationIntent && next.externalContributions?.length;
        if (inject) {
          interrupted = true;
          if (boundary !== 'before-finalize') originalRename(source, target);
          throw new Error('Synthetic integration persistence interruption');
        }
      }
      originalRename(source, target);
    };
    childProcess.spawnSync = ((...args: Parameters<typeof originalSpawn>) => {
      if (args[0] === 'git' && Array.isArray(args[1]) && args[1][0] === 'merge') merges++;
      return originalSpawn(...args);
    }) as typeof originalSpawn;
    syncBuiltinESMExports();
    try {
      assert.throws(() => integrateIsolatedRun(project, isolated, 'documentation'), /Synthetic integration persistence interruption/);
      assert.ok(readRun(project).integrationIntent);
      if (boundary === 'diverged-after-intent') {
        writeFileSync(path.join(project, 'app.mjs'), 'export const price = 9;\n');
        assert.throws(() => integrateIsolatedRun(project, isolated, 'documentation'), /diverged/);
        assert.equal(merges, 0);
        assert.equal(readFileSync(path.join(project, 'app.mjs'), 'utf8'), 'export const price = 9;\n');
        assert.ok(readRun(project).integrationIntent);
        return;
      }
      integrateIsolatedRun(project, isolated, 'documentation');
      assert.equal(merges, 1);
      assert.equal(readRun(project).integrationIntent, undefined);
      assert.equal(readRun(project).externalContributions?.length, 1);
      assert.equal(readFileSync(path.join(project, 'app.mjs'), 'utf8'), 'export const price = 6;\n');
    } finally {
      fs.renameSync = originalRename;
      childProcess.spawnSync = originalSpawn;
      syncBuiltinESMExports();
    }
  });
}

function startIsolatedDocumentation(project: string): string {
  captureCommand([process.execPath, cli, 'park', '--reason', 'Separate documentation work'], project);
  const isolated = path.join(project, '.oso-code-codex/worktrees/documentation');
  captureCommand(['git', 'worktree', 'add', '-q', '-b', 'documentation', isolated, 'HEAD'], project);
  const correction = spec('documentation');
  correction.objective = 'Correct documentation independently';
  correction.blocks[0]!.scope = ['README.md'];
  correction.checks[0]!.inputs = ['README.md'];
  correction.checks[0]!.resources = ['documentation-resource'];
  correction.checks[0]!.command = [process.execPath, '-e', 'require("node:assert/strict").equal(require("node:fs").readFileSync("README.md", "utf8"), "Corrected documentation\\n")'];
  const submission = path.join(project, '.oso-code-codex/isolated-submission.json');
  writeFileSync(submission, JSON.stringify({ specification: correction, authorization: { kind: 'user', reference: 'fixture-isolated-approval', message: 'Implement the independent documentation correction' } }));
  captureCommand([process.execPath, cli, 'start', '--from-run', 'example', '--from-project', project, '--file', submission, '--authorization', submission], isolated);
  return isolated;
}
