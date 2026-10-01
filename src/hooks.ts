import { captureCommand } from './command.ts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { validCheck } from './checks.ts';
import { digest, fileModes, gitFileMode, projectRoot, scopeMatches, snapshot } from './project.ts';
import { readRun, stateDirectory } from './store.ts';
import type { Run } from './types.ts';
import { shellActions } from './shell-actions.ts';
import { ownershipChanges } from './parking.ts';
import { familyBoundary } from './boundaries.ts';
import { recoveryStatus } from './recovery-control.ts';

export interface HookInput {
  hook_event_name: string;
  cwd: string;
  tool_name?: string;
  tool_input?: { command?: string; cmd?: string; input?: string; patch?: string } | string;
}

export function hookDecision(input: HookInput): { allow: boolean; reason?: string } {
  if (!input.cwd || input.hook_event_name !== 'PreToolUse') return { allow: true };
  const tool = input.tool_name ?? '';
  const command = typeof input.tool_input === 'string' ? input.tool_input : input.tool_input?.command ?? input.tool_input?.cmd ?? input.tool_input?.input ?? input.tool_input?.patch ?? '';
  const editing = /apply_patch|Edit|Write/.test(tool);
  const actions = /^(?:Bash|(?:.*[._])?exec_command|shell_command)$/.test(tool) ? shellActions(command) : new Set();
  if (mcpPublicationAction(tool)) actions.add('publication');
  if (!editing && actions.size === 0) return { allow: true };
  try {
    let project: string;
    try { project = projectRoot(input.cwd); } catch (error) {
      if ((error as { status?: number }).status === 128) return { allow: true };
      throw error;
    }
    if (!existsSync(path.join(stateDirectory(project), 'active'))) return { allow: true };
    const run = readRun(project);
    if (run.status === 'closed') return { allow: true };
    if (editing) {
      if (run.status === 'parked') return { allow: false, reason: 'OsoCode: this selected run is parked; retain its evidence and resume it before editing.' };
      if (metadataOnlyPatch(command, run)) return { allow: true };
      if (!run.approval || !run.activeBlock) return { allow: false, reason: 'OsoCode: code edits require authorization and an active approved block. Read status; do not restart the run.' };
      const recovery = recoveryStatus(run);
      if (!recovery.canCorrect) return { allow: false, reason: recovery.pause?.next ?? run.next };
      return { allow: true };
    }
    if (actions.has('commit')) {
      const decision = commitDecision(run);
      if (!decision.allow) return decision;
    }
    if (actions.has('publication')) {
      const publication = familyBoundary(run, 'publication');
      if (publication?.status === 'open') return { allow: false, reason: publication.cause };
      if (!run.approval || !run.spec.publication) return { allow: false, reason: 'Publication or production action is outside the recorded authorization. Obtain approval for the concrete external action.' };
    }
    return { allow: true };
  } catch (error) {
    return { allow: false, reason: `OsoCode could not validate this protected action: ${error instanceof Error ? error.message : String(error)}. Preserve the run and inspect its evidence with the compatible runtime; after a plugin update, continue in a fresh Codex thread.` };
  }
}

function mcpPublicationAction(tool: string): boolean {
  if (!tool.startsWith('mcp__')) return false;
  const action = tool.split('__').at(-1)?.toLocaleLowerCase() ?? '';
  if (/^(?:get|list|read|fetch|search|preview|prepare|status)(?:_|$)/.test(action)) return false;
  return /^(?:publish|deploy)(?:_|$)/.test(action) || ['release', 'create_release', 'create_deployment'].includes(action);
}

function metadataOnlyPatch(patch: string, run: Run): boolean {
  const filenames = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]!);
  return filenames.length > 0 && filenames.every(filename => {
    const relative = path.relative(stateDirectory(run.project), path.resolve(run.project, filename));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && !['runs', 'logs', 'reviews', 'locks', 'active', `${run.spec.id}.json`].includes(relative.split(path.sep)[0]!);
  });
}

function commitDecision(run: Run): { allow: boolean; reason?: string } {
  const commit = familyBoundary(run, 'commit');
  if (commit?.status === 'open') return { allow: false, reason: `Required commit remains blocked: ${commit.cause}. Record actual changed-permission evidence before retrying.` };
  if (!run.approval || run.activeBlock) return { allow: false, reason: 'Close the active block with its executed checks and independent review before committing.' };
  const block = run.blocks.findLast(entry => entry.status === 'closed');
  if (!block) return { allow: false, reason: 'No reviewed block is ready to commit.' };
  const specification = run.spec.blocks.find(entry => entry.id === block.id)!;
  if (digest(JSON.stringify(block.closedSnapshot)) !== digest(JSON.stringify(snapshot(run.project, specification.scope)))) return { allow: false, reason: 'Code changed after block closure; reopen the block and verify affected evidence.' };
  if (!block.closedModes || digest(JSON.stringify(block.closedModes)) !== digest(JSON.stringify(fileModes(run.project, snapshot(run.project, specification.scope))))) return { allow: false, reason: 'Current Git mode provenance is missing or changed after closure; reopen and review the affected change.' };
  const cache = new Map();
  if (specification.checks.some(id => !validCheck(run, id, cache))) return { allow: false, reason: 'Required checks are stale or incomplete.' };
  const staged = captureCommand(['git', 'diff', '--cached', '--name-only', '-z'], run.project).split('\0').filter(Boolean);
  const current = snapshot(run.project);
  const owned = new Set(ownershipChanges(run, run.baseline, run.baselineModes, run.baseHead));
  const unstaged = new Set(captureCommand(['git', 'diff', '--name-only', '-z'], run.project).split('\0'));
  const indexedModes = new Map(captureCommand(['git', 'ls-files', '--stage', '-z'], run.project).split('\0').filter(Boolean).map(entry => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0]!]));
  for (const adoption of run.adoptions ?? []) {
    for (const [filename, hash] of Object.entries(adoption.files)) {
      if (current[filename] === hash && run.baseline[filename] === hash && !unstaged.has(filename) && adoption.modes?.[filename] === gitFileMode(run.project, filename) && adoption.modes[filename] === indexedModes.get(filename)) owned.add(filename);
    }
  }
  if ([...owned].some(filename => !scopeMatches(filename, run.spec.blocks.flatMap(entry => entry.scope)))) return { allow: false, reason: 'Reconcile changes outside the approved run scope before committing.' };
  if (staged.some(filename => !owned.has(filename))) return { allow: false, reason: 'The index includes files this run did not change. Stage only the owned change.' };
  if (staged.some(filename => unstaged.has(filename) || current[filename] !== undefined && indexedModes.get(filename) !== gitFileMode(run.project, filename))) return { allow: false, reason: 'The index differs from the reviewed worktree. Stage the reviewed version before committing.' };
  if (staged.some(filename => !run.blocks.some(entry => entry.status === 'closed' && scopeMatches(filename, run.spec.blocks.find(spec => spec.id === entry.id)!.scope) && entry.closedSnapshot?.[filename] === current[filename]))) return { allow: false, reason: 'A staged file has no matching reviewed checkpoint. Reconcile its approved block before committing.' };
  return { allow: true };
}
