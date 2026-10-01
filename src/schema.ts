import path from 'node:path';
import type { AutoRecoveryPolicy, RunSpec } from './types.ts';
import { assertCheckInputs } from './project.ts';

export function parseSpec(value: unknown, runIds = new Set<string>(), child = false): RunSpec {
  object(value, 'spec');
  identifier(value.id, 'run id');
  unique(runIds, value.id);
  required(value.objective, 'objective');
  required(value.principal, 'principal native session id');
  if (!['plan', 'roadmap', 'quick', 'debug', 'quality-pass'].includes(String(value.mode))) throw new Error('Unsupported execution mode');
  strings(value.decisions, 'decisions', true);
  if (value.recovery !== undefined) recovery(value.recovery);
  if (value.coordination !== undefined) coordination(value.coordination);
  if (value.reviewFallback !== undefined) modelConfiguration(value.reviewFallback, 'reviewFallback');
  if (value.dependsOn !== undefined && !child) throw new Error('dependsOn is only valid for a roadmap child');
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) throw new Error('At least one block is required');
  if (!Array.isArray(value.checks)) throw new Error('checks must be an array');
  const checks = new Set<string>();
  for (const check of value.checks) {
    object(check, 'check');
    identifier(check.id, 'check id');
    unique(checks, check.id);
    strings(check.command, 'command');
    paths(check.inputs, 'check inputs');
    assertCheckInputs(check.inputs);
    if (check.cwd !== undefined) paths([check.cwd], 'check cwd');
    if (check.resources !== undefined) strings(check.resources, 'resources', true);
    if (check.envKeys !== undefined) strings(check.envKeys, 'envKeys', true);
    if (check.pathMode !== undefined && !['lookup', 'literal'].includes(String(check.pathMode))) throw new Error('pathMode must be lookup or literal');
    if (check.timeoutMs !== undefined && (typeof check.timeoutMs !== 'number' || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 7_200_000)) throw new Error('timeoutMs must be between 1 and 7200000');
  }
  const blocks = new Set<string>();
  for (const block of value.blocks) {
    object(block, 'block');
    identifier(block.id, 'block id');
    unique(blocks, block.id);
    required(block.goal, 'block goal');
    paths(block.scope, 'block scope');
    strings(block.criteria, 'block criteria');
    if (!block.criteria.includes('rubric') || !block.criteria.includes('conformance')) throw new Error('Every block requires rubric and conformance criteria');
    strings(block.checks, 'block checks', true);
    for (const check of block.checks) if (!checks.has(check)) throw new Error(`Unknown required check: ${check}`);
    if (block.dependsOn !== undefined) {
      strings(block.dependsOn, 'dependsOn', true);
      for (const dependency of block.dependsOn) if (dependency === block.id || !blocks.has(dependency)) throw new Error(`Dependency must precede block: ${dependency}`);
    }
    if (block.review !== undefined && !['general', 'security', 'design'].includes(String(block.review))) throw new Error('Invalid review dimension');
  }
  if (value.publication !== undefined && typeof value.publication !== 'boolean') throw new Error('publication must be boolean');
  if (value.children !== undefined) {
    if (value.mode !== 'roadmap' || !Array.isArray(value.children)) throw new Error('Only a roadmap can authorize children');
    const preceding = new Set<string>();
    for (const child of value.children) {
      parseSpec(child, runIds, true);
      const record = child as Record<string, unknown>;
      if (record.dependsOn !== undefined) {
        strings(record.dependsOn, 'child dependsOn', true);
        for (const dependency of record.dependsOn) if (!preceding.has(dependency)) throw new Error(`Child dependency must be a preceding sibling: ${dependency}`);
      }
      preceding.add(record.id as string);
    }
  }
  return value as unknown as RunSpec;
}

export function assertAutoRecoveryPolicy(value: unknown, context = ''): asserts value is AutoRecoveryPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('mode' in value) || value.mode !== 'auto') throw new Error(`${context}auto recovery must be an object with mode auto`);
  const policy = value as Record<string, unknown>;
  if (policy.maxCorrections !== undefined && (typeof policy.maxCorrections !== 'number' || !Number.isSafeInteger(policy.maxCorrections) || policy.maxCorrections < 1)) throw new Error(`${context}recovery.maxCorrections must be a positive safe integer`);
  if (Object.keys(policy).some(key => key !== 'mode' && key !== 'maxCorrections')) throw new Error(`${context}auto recovery accepts only mode and maxCorrections`);
}

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function required(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`);
}

function identifier(value: unknown, label: string): asserts value is string {
  required(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`${label} must contain lowercase letters, numbers or hyphens`);
}

function strings(value: unknown, label: string, empty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!empty && value.length === 0)) throw new Error(`${label} must be ${empty ? 'an' : 'a nonempty'} array`);
  for (const entry of value) required(entry, label);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}

function paths(value: unknown, label: string): asserts value is string[] {
  strings(value, label);
  for (const entry of value) if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..') || entry.includes('\0') || entry.includes('\\')) throw new Error(`${label} must be project-relative paths or globs`);
}

function recovery(value: unknown): void {
  object(value, 'recovery');
  if (value.mode === 'auto') {
    assertAutoRecoveryPolicy(value);
    return;
  }
  if (typeof value.maxCorrections !== 'number' || !Number.isSafeInteger(value.maxCorrections) || value.maxCorrections < 1) throw new Error('recovery.maxCorrections must be a positive safe integer');
  if (Object.keys(value).some(key => key !== 'maxCorrections')) throw new Error('recovery accepts only maxCorrections, or mode auto');
}

function coordination(value: unknown): void {
  object(value, 'coordination');
  if (Object.keys(value).some(key => key !== 'maxActiveAgents') || typeof value.maxActiveAgents !== 'number' || !Number.isSafeInteger(value.maxActiveAgents) || value.maxActiveAgents < 1) throw new Error('coordination.maxActiveAgents must be a positive safe integer');
}

function modelConfiguration(value: unknown, label: string): void {
  object(value, label);
  if (Object.keys(value).some(key => key !== 'model' && key !== 'reasoningEffort' && key !== 'forkTurns') || typeof value.model !== 'string' || !value.model.trim() || typeof value.reasoningEffort !== 'string' || !value.reasoningEffort.trim() || value.forkTurns !== undefined && value.forkTurns !== 'none') throw new Error(`${label} requires model, reasoningEffort and optional forkTurns:none`);
}

function unique(seen: Set<string>, name: string): void {
  if (seen.has(name)) throw new Error(`Duplicate id: ${name}`);
  seen.add(name);
}
