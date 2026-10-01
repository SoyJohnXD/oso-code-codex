import { executeCheck } from '../src/checks.ts';
import { captureCommand } from '../src/command.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { activateBlock, authorize, startRun } from '../src/lifecycle.ts';
import { closeBlock, closeRun, finishAgent, recordReview, registerAgent } from '../src/reviews.ts';
import { readRun, writeRun } from '../src/store.ts';
import type { Run, RunSpec } from '../src/types.ts';

export function fixture(context: TestContext): string {
  const project = mkdtempSync(path.join(tmpdir(), 'oso-code-codex-test-'));
  context.after(() => rmSync(project, { recursive: true, force: true }));
  captureCommand(['git', 'init', '-q', project], project);
  writeFileSync(path.join(project, 'app.mjs'), 'export const price = 5;\n');
  writeFileSync(path.join(project, 'README.md'), 'Fixture\n');
  captureCommand(['git', 'add', '.'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], project);
  return project;
}

export function spec(id = 'example'): RunSpec {
  return { id, mode: 'quick', objective: 'Update price', principal: 'native-parent', decisions: ['Preserve the full rubric'],
    checks: [{ id: 'unit', command: [process.execPath, '-e', 'console.log("PASS")'], inputs: ['app.mjs'] }],
    blocks: [{ id: 'price', goal: 'Price works', scope: ['app.mjs'], criteria: ['rubric', 'conformance', 'price'], checks: ['unit'] }],
  };
}

export function approved(project: string, specification = spec()): Run {
  const run = startRun(project, specification);
  authorize(run, { kind: 'user', reference: 'fixture-native-turn', message: 'Implement the presented fixture plan', specDigest: run.specDigest });
  activateBlock(run, specification.blocks[0]!.id);
  writeRun(run);
  return run;
}

export function reviewed(run: Run, report = 'I inspected pricing and checked the recorded command output. The change satisfies the three criteria.'): void {
  registerAgent(run, { id: 'native-reviewer', role: 'reviewer', tier: 'luna', scope: ['app.mjs'] });
  finishAgent(run, 'native-reviewer', report);
  recordReview(run, { agent: 'native-reviewer', kind: 'general', criteria: ['rubric', 'conformance', 'price'], verdict: 'pass' });
}

export async function closeDocumentationCorrection(project: string): Promise<void> {
  writeFileSync(path.join(project, 'README.md'), 'Corrected documentation\n');
  await executeCheck(project, 'unit');
  const correction = readRun(project);
  registerAgent(correction, { id: 'documentation-reviewer', role: 'reviewer', tier: 'luna', scope: ['README.md'] });
  finishAgent(correction, 'documentation-reviewer', 'Synthetic independent fixture review covers the corrected documentation and its real assertion.');
  recordReview(correction, { agent: 'documentation-reviewer', kind: 'general', criteria: correction.spec.blocks[0]!.criteria, verdict: 'pass' });
  closeBlock(correction);
  closeRun(correction);
  writeRun(correction);
  captureCommand(['git', 'add', 'README.md'], project);
  captureCommand(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'reviewed-documentation'], project);
}
