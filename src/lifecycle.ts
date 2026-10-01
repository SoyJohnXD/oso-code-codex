import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { captureCommand } from './command.ts';
import { digest, fileModes, gitFileMode, scopeMatches, snapshot } from './project.ts';
import { initializeStore, readRun, selectRun, stateDirectory, transaction, writeRun } from './store.ts';
import { ownershipChanges } from './parking.ts';
import { roadmapBaseline } from './roadmap-lineage.ts';
import type { Approval, BlockSpec, BlockState, RoadmapAuthority, Run, RunLink, RunSpec, Snapshot } from './types.ts';

interface StartOptions { parkedPredecessor?: string; deferSelection?: boolean; initialLink?: RunLink; roadmapParent?: string }

export function startRun(project: string, spec: RunSpec, options: StartOptions = {}): Run {
  const { parkedPredecessor, deferSelection, initialLink, roadmapParent } = options;
  initializeStore(project);
  return transaction(project, () => {
    if (existsSync(path.join(stateDirectory(project), 'runs', `${spec.id}.json`))) throw new Error('Run already exists; resume it to retain evidence and recovery budgets');
    let parent = roadmapParent ? readRun(project, roadmapParent) : undefined;
    if (existsSync(path.join(stateDirectory(project), 'active'))) {
      const current = readRun(project);
      const approvedChild = current.spec.children?.some(child => digest(JSON.stringify(child)) === digest(JSON.stringify(spec)));
      if (approvedChild) parent ??= current;
      const parkedRoadmapSibling = current.status === 'parked' && roadmapParent && current.approval?.kind === 'roadmap' && current.approval.parentRun === roadmapParent;
      if (current.status !== 'closed' && !(parkedPredecessor === current.spec.id && current.status === 'parked') && !approvedChild && !parkedRoadmapSibling) throw new Error(`Run ${current.spec.id} remains active; resume it instead of replacing its budget`);
    }
    if (parent && (!parent.approval || parent.status === 'closed' || parent.spec.mode !== 'roadmap' || digest(JSON.stringify(parent.spec)) !== parent.specDigest || !parent.spec.children?.some(child => digest(JSON.stringify(child)) === digest(JSON.stringify(spec))))) throw new Error('Initial child origin requires the exact approved unfinished roadmap');
    const now = new Date().toISOString();
    const baseline = snapshot(project);
    const specDigest = digest(JSON.stringify(spec));
    const inheritedOwner = parent?.recovery && (parent.recovery.owner === parent.spec.id ? parent : readRun(project, parent.recovery.owner));
    const recovery = parent?.recovery
      ? { owner: parent.recovery.owner, specDigest: parent.recovery.specDigest }
      : spec.recovery?.mode === 'auto'
        ? parent ? undefined : { owner: spec.id, specDigest, policy: spec.recovery, policySource: 'spec' as const, grants: [], adoptions: [] }
        : spec.recovery ? { owner: spec.id, specDigest, initialLimit: spec.recovery.maxCorrections, grants: [] } : undefined;
    const version: Run['version'] = parent || truthfulAccounting(spec) ? 5 : inheritedOwner?.recovery?.policy || spec.recovery?.mode === 'auto' ? 4 : recovery ? 3 : parkedPredecessor || initialLink ? 2 : 1;
    const run: Run = {
      version, project, spec, specDigest, created: now, updated: now,
      ...(version === 1 ? {} : { readerMinimumVersion: version }),
      ...(recovery ? { recovery } : {}),
      ...(parkedPredecessor || initialLink ? { link: initialLink ?? { parkedRun: parkedPredecessor!, kind: 'parked-successor', createdAt: now } } as const : {}),
      ...(parent ? { roadmapOrigin: { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: spec.id }, roadmapLineage: { baseline: roadmapBaseline(parent, spec), amendments: [] } } : {}),
      status: 'pending-approval', baseline, baselineModes: fileModes(project, baseline), baseHead: captureCommand(['git', 'rev-parse', '--revs-only', 'HEAD'], project).trim() || undefined, blocks: spec.blocks.map(block => newBlockState(block.id, spec)),
      checks: [], agents: [], finalReviews: [], next: 'Record the actual user authorization, then activate the first block', imports: [], events: [],
    };
    event(run, 'start', spec.objective);
    writeRun(run);
    if (!deferSelection) selectRun(run);
    return run;
  });
}

export function promoteRecoveryRecord(run: Run, minimum: 3 | 4 | 5): void {
  const version = Math.max(run.version, run.readerMinimumVersion ?? 1, minimum) as 2 | 3 | 4 | 5;
  run.version = version;
  run.readerMinimumVersion = version;
}

function truthfulAccounting(specification: RunSpec): boolean {
  return specification.coordination !== undefined || specification.reviewFallback !== undefined;
}

export function newBlockState(id: string, specification: RunSpec): BlockState {
  return truthfulAccounting(specification)
    ? { id, status: 'pending', writers: [], contributions: [], reviews: [], findings: [], rounds: [] }
    : { id, status: 'pending', writers: [specification.principal], implementationTier: 'luna', reviews: [], findings: [], rounds: [] };
}

export function authorize(run: Run, approval: Approval): void {
  if (run.status !== 'pending-approval') throw new Error('This run already has an authorization; resume it');
  if (approval.kind === 'user') {
    if (!approval.reference?.trim() || !approval.message?.trim() || approval.specDigest !== run.specDigest) throw new Error('User authorization needs the actual message, its session/turn reference and this spec digest');
  } else if (approval.kind === 'roadmap') {
    if (!matchesRoadmapAuthority(run.roadmapOrigin, approval)) throw new Error('Pending child lacks the exact durable roadmap origin; preserve its baseline and reconcile its original authority');
    const parent = readRun(run.project, approval.parentRun);
    const approvedChild = parent.spec.children?.find(child => child.id === approval.child);
    if (!parent.approval || parent.status === 'closed' || parent.spec.mode !== 'roadmap' || parent.specDigest !== approval.parentDigest || !approvedChild || digest(JSON.stringify(approvedChild)) !== run.specDigest) throw new Error('Child is outside the approved roadmap; a material scope change requires user authorization');
  } else throw new Error('Unsupported authorization source');
  run.approval = approval;
  run.status = 'running';
  run.next = `Activate ${run.blocks[0]!.id}`;
  event(run, 'authorize', approval.kind === 'user' ? approval.reference : `roadmap:${approval.parentRun}/${approval.child}`);
}

export function matchesRoadmapAuthority(actual: RoadmapAuthority | undefined, expected: RoadmapAuthority): boolean {
  return actual?.parentRun === expected.parentRun && actual.parentDigest === expected.parentDigest && actual.child === expected.child;
}

export function activateBlock(run: Run, id: string): void {
  requireAuthorization(run);
  if (run.activeBlock && run.activeBlock !== id) throw new Error(`Finish active block ${run.activeBlock} first`);
  const block = run.blocks.find(entry => entry.id === id);
  const specification = run.spec.blocks.find(entry => entry.id === id);
  if (!block || !specification) throw new Error(`Unknown block: ${id}`);
  if (block.status === 'closed') throw new Error('Block is closed; do not reset its evidence or budget');
  for (const dependency of specification.dependsOn ?? []) if (run.blocks.find(entry => entry.id === dependency)?.status !== 'closed') throw new Error(`Dependency remains open: ${dependency}`);
  if (!block.baseline) {
    block.baseline = snapshot(run.project);
    block.baselineModes = fileModes(run.project, block.baseline);
  }
  if (block.status !== 'blocked') block.status = 'active';
  run.activeBlock = id;
  run.next = block.failure ? `Resolve ${block.failure.kind}: ${block.failure.cause}` : `Implement and verify ${id}`;
  event(run, 'activate', id);
}

export function activeBlock(run: Run): { block: BlockState; specification: BlockSpec } {
  requireAuthorization(run);
  const block = run.blocks.find(entry => entry.id === run.activeBlock);
  const specification = run.spec.blocks.find(entry => entry.id === run.activeBlock);
  if (!block || !specification) throw new Error('No active block; activate an approved block first');
  return { block, specification };
}

export function requireAuthorization(run: Run, context: 'execution' | 'metadata' = 'execution'): void {
  if (!run.approval || run.status === 'pending-approval') throw new Error('Execution requires user authorization or an exact child of an approved roadmap');
  if (run.status === 'closed' || context === 'execution' && run.status === 'parked') throw new Error(run.status === 'parked' ? 'Run is parked; resume its retained identity before execution' : 'Run is closed');
  if (digest(JSON.stringify(run.spec)) !== run.specDigest) throw new Error('Approved specification was changed; record a material amendment with user authorization');
}

export function assertScope(run: Run, block: BlockState, specification: BlockSpec): void {
  const outside = ownershipChanges(run, block.baseline ?? {}, block.baselineModes, 'HEAD').filter(name => !scopeMatches(name, specification.scope));
  if (outside.length) throw new Error(`Changes outside approved block scope need reconciliation: ${outside.join(', ')}`);
}

export function event(run: Run, action: string, detail: string): void {
  run.events.push({ at: new Date().toISOString(), action, detail });
}

export function importLegacy(run: Run, filename: string): void {
  const contents = readFileSync(filename);
  run.imports.push({ source: path.resolve(filename), digest: digest(contents), at: new Date().toISOString() });
  event(run, 'legacy-import', `${filename}: provenance only; approval, checks and reviews were not promoted`);
}

export function adoptPreservedWork(run: Run, files: Snapshot, authorization: Approval): void {
  requireAuthorization(run);
  if (authorization.kind !== 'user' || !authorization.reference?.trim() || !authorization.message?.trim() || authorization.specDigest !== run.specDigest) throw new Error('Adoption requires the actual user authorization bound to this specification');
  if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.keys(files).length) throw new Error('Adoption requires explicit file paths and their current SHA256 hashes');
  const now = snapshot(run.project);
  const pending = new Set([
    ...captureCommand(['git', 'diff', '--name-only', '-z'], run.project).split('\0'),
    ...captureCommand(['git', 'diff', '--cached', '--name-only', '-z'], run.project).split('\0'),
    ...captureCommand(['git', 'ls-files', '--others', '--exclude-standard', '-z'], run.project).split('\0'),
  ]);
  const baseModes = new Map((run.baseHead ? captureCommand(['git', 'ls-tree', '-r', '-z', run.baseHead], run.project) : '').split('\0').filter(Boolean).map(entry => [entry.slice(entry.indexOf('\t') + 1), entry.split(' ')[0]!]));
  const modes: Snapshot = {};
  for (const [filename, hash] of Object.entries(files)) {
    if (!Object.hasOwn(now, filename) || !scopeMatches(filename, run.spec.blocks.flatMap(block => block.scope))) throw new Error(`Adoption is outside the approved source scope: ${filename}`);
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || hash !== now[filename] || hash !== run.baseline[filename]) throw new Error(`Adoption must match unchanged work preserved in the original baseline: ${filename}`);
    if (!pending.has(filename)) throw new Error(`Adoption requires an uncommitted change: ${filename}`);
    modes[filename] = gitFileMode(run.project, filename);
    if (modes[filename] !== (baseModes.get(filename) ?? '100644')) throw new Error(`Adoption cannot include a Git mode change or a new executable/symlink: ${filename}`);
  }
  run.adoptions ??= [];
  if (run.adoptions.some(entry => digest(JSON.stringify(entry.files)) === digest(JSON.stringify(files)) && digest(JSON.stringify(entry.authorization)) === digest(JSON.stringify(authorization)))) return;
  run.adoptions.push({ files: { ...files }, modes, authorization: { ...authorization }, at: new Date().toISOString() });
  event(run, 'adopt-preserved-work', JSON.stringify({ files, modes, reference: authorization.reference }));
}
