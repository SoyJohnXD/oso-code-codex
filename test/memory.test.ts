import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { captureCommand } from '../src/command.ts';
import { approved, fixture, spec } from './support.ts';
import type { MemoryEntry, PendingMemory } from '../src/memory.ts';
import { confirmMemoryDelivery, pendingMemory, queueMemory } from '../src/memory.ts';
import { authorizeRecovery, recoveryBudget } from '../src/recovery-policy.ts';
import { selectRoadmapChild } from '../src/roadmap.ts';
import { writeRun } from '../src/store.ts';

const cli = path.resolve('src/cli.ts');

function memory<T = PendingMemory>(project: string, action: string, input?: object): T {
  const filename = path.join(project, '.oso-code-codex/memory-submission.json');
  if (input) writeFileSync(filename, JSON.stringify(input));
  return JSON.parse(captureCommand([process.execPath, cli, 'memory', action, ...(input ? ['--file', filename] : [])], project));
}

test('pending memory rejects old lifecycle state and confirms only the delivered revision', context => {
  const project = fixture(context);
  approved(project);
  const first = memory(project, 'pending');
  const draft = { project: 'shared-project', topic: 'oso/example/plan', content: 'Executing initial block', error: 'MCP unavailable', position: first.position };
  const queued = memory<MemoryEntry>(project, 'queue', draft);
  captureCommand([process.execPath, cli, 'park', '--reason', 'Independent task'], project);
  assert.equal(memory(project, 'pending').entries[0]!.stale, true);
  assert.throws(() => memory(project, 'delivered', { id: queued.id, evidence: 'Delayed old MCP acknowledgement' }), /stale/);
  const parked = memory<MemoryEntry>(project, 'queue', { ...draft, content: 'Executing; parked at price', position: memory(project, 'pending').position, previousId: queued.id });
  assert.throws(() => memory(project, 'queue', draft), /stale|revision/i);
  memory(project, 'delivered', { id: queued.id, evidence: 'Earlier native MCP write succeeded' });
  assert.equal(memory(project, 'pending').entries[0]!.id, parked.id);
  memory(project, 'delivered', { id: parked.id, evidence: 'Read current Engram observation, merged, and mem_update succeeded' });
  assert.equal(memory(project, 'pending').entries.length, 0);
});

test('a concurrent topic revision must be merged before replacement at the same run position', context => {
  const project = fixture(context);
  approved(project);
  const position = memory(project, 'pending').position;
  const draft = { project: 'shared-project', topic: 'oso/index', content: 'Initial rows', error: 'MCP unavailable', position };
  const first = memory<MemoryEntry>(project, 'queue', draft);
  const second = memory<MemoryEntry>(project, 'queue', { ...draft, content: 'Initial rows plus current child', previousId: first.id });
  assert.throws(() => memory(project, 'queue', { ...draft, content: 'Late stale rows', previousId: first.id }), /revision/);
  assert.equal(memory(project, 'pending').entries[0]!.id, second.id);
  const full = JSON.parse(readFileSync(path.join(project, '.oso-code-codex/memory-pending.json'), 'utf8'));
  assert.equal(full.entries[0].superseded[0].content, 'Initial rows');
});

test('memory queue preserves other topics and pending reads do not mutate files', context => {
  const project = fixture(context);
  approved(project);
  const position = memory(project, 'pending').position;
  for (const topic of ['oso/example/plan', 'oso/index']) memory(project, 'queue', { project: 'shared-project', topic, content: topic, error: 'MCP unavailable', position });
  const filename = path.join(project, '.oso-code-codex/memory-pending.json');
  const before = readFileSync(filename, 'utf8');
  const pending = memory(project, 'pending');
  assert.equal(readFileSync(filename, 'utf8'), before);
  assert.equal(pending.entries.length, 2);
  memory(project, 'delivered', { id: pending.entries[0]!.id, evidence: 'Actual MCP acknowledgement' });
  assert.equal(memory(project, 'pending').entries[0]!.topic, 'oso/index');
  writeFileSync(filename, '{broken');
  assert.throws(() => memory(project, 'pending'));
  assert.equal(readFileSync(filename, 'utf8'), '{broken');
});

test('a queued child projection becomes stale when its root recovery authority changes', context => {
  const project = fixture(context);
  const roadmap = spec('memory-roadmap');
  roadmap.mode = 'roadmap';
  roadmap.recovery = { maxCorrections: 2 };
  roadmap.children = [spec('memory-child')];
  approved(project, roadmap);
  const child = selectRoadmapChild(project, roadmap.id, 'memory-child');
  const position = pendingMemory(project).position;
  const queued = queueMemory(project, { project: 'fixture', topic: 'oso/memory-child/plan', content: 'Two shared corrections available', error: 'Synthetic MCP outage', position });
  const budget = recoveryBudget(child);
  const owner = authorizeRecovery(child, { owner: budget.owner, specDigest: budget.specDigest, revision: budget.revision, additionalCorrections: 2, authorization: { kind: 'user', reference: 'synthetic-user/+2', message: 'Two additional shared corrections approved', specDigest: budget.specDigest } });
  writeRun(owner);
  assert.equal(pendingMemory(project).position.revision, position.revision);
  assert.equal(pendingMemory(project).entries[0]!.stale, true);
  assert.throws(() => confirmMemoryDelivery(project, { id: queued.id, evidence: 'Delayed delivery with previous budget' }), /stale/);
  assert.equal(pendingMemory(project).entries[0]!.id, queued.id);
});
