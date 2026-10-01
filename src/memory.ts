import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite, initializeStore, readRun, stateDirectory, transaction } from './store.ts';
import { recoveryBudget } from './recovery-policy.ts';

interface MemoryPosition { runId?: string; revision: number; recoveryRevision?: string }
interface MemoryDraft {
  project: string;
  topic: string;
  observationId?: number;
  content: string;
  error: string;
  position: MemoryPosition;
  previousId?: string;
}
export interface MemoryEntry extends MemoryDraft { id: string; superseded: MemoryDraft[] }
export interface PendingMemory { position: MemoryPosition; entries: (Omit<MemoryEntry, 'content' | 'superseded'> & { stale: boolean; content?: string; superseded?: MemoryDraft[] })[] }
interface MemoryQueue { version: 1; entries: MemoryEntry[] }

export function pendingMemory(project: string, full = false): PendingMemory {
  return { position: memoryPosition(project), entries: readQueue(project).entries.map(entry => {
    const { content, superseded, ...metadata } = entry;
    return { ...metadata, stale: !samePosition(entry.position, memoryPosition(project, entry.position.runId)), ...(full ? { content, superseded } : {}) };
  }) };
}

export function queueMemory(project: string, value: unknown): MemoryEntry {
  const draft = parseDraft(value);
  initializeStore(project);
  return transaction(project, () => {
    if (!samePosition(draft.position, memoryPosition(project, draft.position.runId))) throw new Error('Pending memory revision is stale; reconcile the current run and Engram observation before queueing its latest state');
    const queue = readQueue(project);
    const previous = queue.entries.find(entry => entry.project === draft.project && entry.topic === draft.topic);
    if (previous && previous.content === draft.content && previous.observationId === draft.observationId && samePosition(previous.position, draft.position)) return previous;
    if (previous && draft.previousId !== previous.id) throw new Error('Pending topic revision changed; read and merge its current entry before replacing it');
    const { previousId, ...current } = draft;
    const entry: MemoryEntry = { ...current, id: randomUUID(), superseded: previous ? [...previous.superseded, { project: previous.project, topic: previous.topic, observationId: previous.observationId, content: previous.content, error: previous.error, position: previous.position }] : [] };
    queue.entries = queue.entries.filter(candidate => candidate !== previous);
    queue.entries.push(entry);
    writeQueue(project, queue);
    return entry;
  });
}

export function confirmMemoryDelivery(project: string, value: unknown): { removed: boolean } {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !value.id.trim() || !('evidence' in value) || typeof value.evidence !== 'string' || !value.evidence.trim()) throw new Error('Memory delivery requires the exact queued id and actual MCP acknowledgement evidence');
  return transaction(project, () => {
    const queue = readQueue(project);
    const delivered = queue.entries.find(entry => entry.id === value.id);
    if (delivered && !samePosition(delivered.position, memoryPosition(project, delivered.position.runId))) throw new Error('Delivered memory revision is stale; retain the pending handoff and reconcile the current state');
    const remaining = queue.entries.filter(entry => entry.id !== value.id);
    if (remaining.length === queue.entries.length) return { removed: false };
    writeQueue(project, { ...queue, entries: remaining });
    return { removed: true };
  });
}

function memoryPosition(project: string, runId?: string): MemoryPosition {
  if (!runId && !existsSync(path.join(stateDirectory(project), 'active'))) return { revision: 0 };
  const run = readRun(project, runId);
  return { runId: run.spec.id, revision: run.events.length, recoveryRevision: recoveryBudget(run).revision };
}

function samePosition(left: MemoryPosition, right: MemoryPosition): boolean { return left.runId === right.runId && left.revision === right.revision && left.recoveryRevision === right.recoveryRevision; }

function readQueue(project: string): MemoryQueue {
  const filename = path.join(stateDirectory(project), 'memory-pending.json');
  if (!existsSync(filename)) return { version: 1, entries: [] };
  const queue = JSON.parse(readFileSync(filename, 'utf8')) as MemoryQueue;
  if (queue.version !== 1 || !Array.isArray(queue.entries)) throw new Error('Unsupported memory queue; preserve it and reconcile its entries before changing format');
  for (const entry of queue.entries) {
    parseDraft(entry);
    if (!entry.id || !Array.isArray(entry.superseded)) throw new Error('Invalid memory queue entry; preserve its pending content');
  }
  return queue;
}

function writeQueue(project: string, queue: MemoryQueue): void { atomicWrite(path.join(stateDirectory(project), 'memory-pending.json'), JSON.stringify(queue, null, 2) + '\n'); }

function parseDraft(value: unknown): MemoryDraft {
  if (!value || typeof value !== 'object') throw new Error('Memory draft must be an object');
  const draft = value as MemoryDraft;
  for (const key of ['project', 'topic', 'content', 'error'] as const) if (typeof draft[key] !== 'string' || !draft[key].trim()) throw new Error(`Memory draft requires ${key}`);
  if (draft.observationId !== undefined && (!Number.isSafeInteger(draft.observationId) || draft.observationId <= 0)) throw new Error('Memory observation id must be a positive integer');
  if (!draft.position || !Number.isSafeInteger(draft.position.revision) || draft.position.revision < 0 || draft.position.runId !== undefined && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.position.runId)) throw new Error('Memory draft requires the observed run id and revision from memory pending');
  if (draft.position.recoveryRevision !== undefined && !/^[a-f0-9]{64}$/.test(draft.position.recoveryRevision)) throw new Error('Memory recovery revision must match the observed recovery budget');
  return draft;
}
