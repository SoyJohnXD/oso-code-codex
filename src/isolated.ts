import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { captureCommand } from './command.ts';
import { blockIntegrationBoundary, familyBoundary } from './boundaries.ts';
import { changedCheckoutFiles, matchesClosedCheckpoint } from './contributions.ts';
import { event, startRun } from './lifecycle.ts';
import { checkoutState, ensureLifecycleVersion } from './parking.ts';
import { digest, scopeMatches } from './project.ts';
import { acquireLock, listRuns, readRun, selectRun, stateDirectory, writeRun } from './store.ts';
import type { CheckoutState, ExternalContribution, IntegrationIntent, Run, RunSpec } from './types.ts';

export function startIsolatedRun(project: string, sourceProject: string, sourceId: string, specification: RunSpec): Run {
  const source = readRun(sourceProject, sourceId);
  if (source.status !== 'parked' || !source.parked) throw new Error(`Source run ${sourceId} must be parked before isolated work starts`);
  if (source.checks.some(check => check.status === 'running') || source.agents.some(agent => agent.status !== 'finished')) throw new Error(`Source run ${sourceId} has unresolved native handles`);
  if (source.spec.id === specification.id || source.spec.objective.trim().toLocaleLowerCase() === specification.objective.trim().toLocaleLowerCase() && source.blocks.some(block => block.failure)) throw new Error('An isolated successor cannot replace the parked run or escape its failed objective budget');
  const commonDirectory = commonGitDirectory(project, sourceProject);
  const parkHead = requiredHead(source.parked.checkout.head, 'Parked source has no Git head');
  if (head(project) !== parkHead || captureCommand(['git', 'status', '--porcelain=v1'], project).trim()) throw new Error('Isolated checkout must be clean and start exactly from the parked source head');
  ensureLifecycleVersion(source);
  let forward = source.isolatedSuccessors?.find(successor => successor.project === project && successor.run === specification.id);
  if (!forward) {
    forward = { project, run: specification.id, commonDirectory, parkHead, status: 'starting' };
    (source.isolatedSuccessors ??= []).push(forward);
    event(source, 'isolated-successor-starting', `${specification.id}@${project}`);
    writeRun(source);
  }
  const existing = listRuns(project).find(candidate => candidate.spec.id === specification.id);
  if (existing) {
    const cross = existing.link?.crossProject;
    if (existing.specDigest !== digest(JSON.stringify(specification)) || cross?.sourceProject !== sourceProject || cross.sourceRun !== source.spec.id || cross.parkHead !== parkHead) throw new Error(`Existing isolated run ${specification.id} does not match this source and approved specification`);
    forward.status = 'active';
    event(source, 'isolated-successor-recovered', `${existing.spec.id}@${project}`);
    writeRun(source);
    selectRun(existing);
    return existing;
  }
  const now = new Date().toISOString();
  const run = startRun(project, specification, { parkedPredecessor: source.spec.id, deferSelection: true, initialLink: { parkedRun: source.spec.id, kind: 'parked-successor', createdAt: now, crossProject: { sourceProject, sourceRun: source.spec.id, commonDirectory, parkHead } } });
  run.next = `Record the separate approved objective; source ${source.spec.id} remains parked with its partial work intact.`;
  writeRun(run);
  forward.status = 'active';
  event(source, 'isolated-successor', `${run.spec.id}@${project}`);
  writeRun(source);
  selectRun(run);
  return run;
}

export function integrateIsolatedRun(project: string, sourceProject: string, sourceId: string): Run {
  const release = acquireLock(path.join(stateDirectory(project), 'locks', 'cross-project-integration'));
  try { return integrateLocked(project, sourceProject, sourceId); } finally { release(); }
}

function integrateLocked(project: string, sourceProject: string, sourceId: string): Run {
  const target = readRun(project);
  const source = readRun(sourceProject, sourceId);
  const link = source.link?.crossProject;
  if (target.status !== 'parked' || !target.parked) throw new Error('Integration requires the parked source run selected in its original checkout');
  if (!link || link.sourceProject !== project || link.sourceRun !== target.spec.id) throw new Error(`Run ${sourceId} is not the recorded isolated successor of ${target.spec.id}`);
  if (commonGitDirectory(project, sourceProject) !== link.commonDirectory) throw new Error('Isolated worktree no longer belongs to the recorded shared Git repository');
  if (source.status !== 'closed' || source.activeBlock || source.blocks.some(block => block.status !== 'closed')) throw new Error(`Isolated run ${sourceId} needs all reviewed checkpoints closed before integration`);
  if (captureCommand(['git', 'status', '--porcelain=v1'], sourceProject).trim()) throw new Error(`Isolated run ${sourceId} must be cleanly committed before integration`);
  const sourceHead = head(sourceProject);
  if (!isAncestor(sourceProject, link.parkHead, sourceHead)) throw new Error('Isolated branch is not linear from the parked source head; integration remains pending without changing the source checkout');
  if (captureCommand(['git', 'rev-list', '--merges', `${link.parkHead}..${sourceHead}`], sourceProject).trim()) throw new Error('Isolated branch contains a merge commit; integration remains pending without changing the source checkout');
  if (!checkoutState(sourceProject).branch || checkoutState(sourceProject).branch === target.parked.checkout.branch) throw new Error('Isolated work must remain on its own branch before integration');
  const contribution = verifiedContribution(source, link.parkHead, sourceHead, sourceProject);
  if (link.integration === 'integrated') {
    if (head(project) !== sourceHead || !contributionPresent(checkoutState(project), contribution)) throw new Error('Isolated record says integrated but the parked checkout does not contain the recorded contribution; preserve both worktrees and reconcile the divergence');
    return finalizeIntegration(target, source, contribution);
  }
  const partial = partialPaths(project);
  const overlap = changedCheckoutFiles(contribution.before, contribution.after).filter(filename => partial.has(filename));
  if (overlap.length) {
    markPending(source, target, `Integration collision with parked partial paths: ${overlap.join(', ')}`);
    throw new Error(`Integration collision with parked partial paths: ${overlap.join(', ')}. The parked checkout remains unchanged.`);
  }
  const before = checkoutState(project);
  const beforeIndexDigest = indexDigest(project);
  const after = applyContribution(before, contribution);
  after.head = sourceHead;
  const intent = target.integrationIntent;
  if (intent) return recoverIntegration(target, source, contribution, intent, project);
  const nextIntent: IntegrationIntent = { sourceProject, sourceRun: source.spec.id, sourceSpecDigest: source.specDigest, checkpoints: contribution.reviewedCheckpoints, commits: contribution.commits, before, after, beforeIndexDigest, expectedIndexDigest: beforeIndexDigest, createdAt: new Date().toISOString() };
  target.integrationIntent = nextIntent;
  event(target, 'integration-intent', `${source.spec.id}@${sourceProject}`);
  writeRun(target);
  return performIntegration(target, source, contribution, nextIntent, project);
}

export function namedResourceLockDirectory(run: Run): string | undefined {
  const coordinator = run.link?.crossProject?.sourceProject ?? (run.isolatedSuccessors?.length ? run.project : undefined);
  return coordinator ? path.join(stateDirectory(coordinator), 'locks', 'cross-project') : undefined;
}

export function crossProjectPeers(run: Run): Run[] {
  const peers: Run[] = [];
  if (run.link?.crossProject) peers.push(readRun(run.link.crossProject.sourceProject, run.link.crossProject.sourceRun));
  for (const successor of run.isolatedSuccessors ?? []) {
    const filename = path.join(stateDirectory(successor.project), 'runs', `${successor.run}.json`);
    if (existsSync(filename)) peers.push(readRun(successor.project, successor.run));
  }
  return peers;
}

function recoverIntegration(target: Run, source: Run, contribution: ExternalContribution, intent: IntegrationIntent, project: string): Run {
  if (intent.sourceProject !== source.project || intent.sourceRun !== source.spec.id || intent.sourceSpecDigest !== source.specDigest || digest(JSON.stringify(intent.checkpoints)) !== digest(JSON.stringify(contribution.reviewedCheckpoints)) || digest(JSON.stringify(intent.commits)) !== digest(JSON.stringify(contribution.commits))) throw new Error('Stored integration intent no longer matches the reviewed isolated record; preserve both worktrees and reconcile the divergence');
  const current = checkoutState(project);
  const index = indexDigest(project);
  if (sameState(current, intent.after) && index === intent.expectedIndexDigest) return finalizeIntegration(target, source, contribution);
  if (!sameState(current, intent.before) || index !== intent.beforeIndexDigest) throw new Error('Integration intent diverged from both its recorded before and expected after state; preserve both worktrees and reconcile without retrying Git');
  return performIntegration(target, source, contribution, intent, project);
}

function performIntegration(target: Run, source: Run, contribution: ExternalContribution, intent: IntegrationIntent, project: string): Run {
  const boundary = familyBoundary(target, 'commit');
  if (boundary?.status === 'open') throw new Error(`Required commit remains blocked: ${boundary.cause}`);
  try { captureCommand(['git', 'merge', '--ff-only', requiredHead(intent.after.head, 'Missing isolated integration head')], project); } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    blockIntegrationBoundary(target, intent, `Integration merge failed through the native Git action: ${cause}`);
    event(target, 'integration-failed', cause);
    writeRun(target);
    throw error;
  }
  if (!sameState(checkoutState(project), intent.after) || indexDigest(project) !== intent.expectedIndexDigest) throw new Error('Git integration completed but the recorded expected checkout or index state did not match; preserve both worktrees and reconcile the divergence');
  return finalizeIntegration(target, source, contribution);
}

function finalizeIntegration(target: Run, source: Run, contribution: ExternalContribution): Run {
  const contributions = target.externalContributions ??= [];
  if (!contributions.some(entry => entry.sourceRun === source.spec.id && entry.sourceSpecDigest === source.specDigest)) contributions.push(contribution);
  delete target.integrationIntent;
  const successor = target.isolatedSuccessors?.find(entry => entry.project === source.project && entry.run === source.spec.id);
  if (successor) successor.status = 'integrated';
  source.link!.crossProject!.integration = 'integrated';
  source.next = `Integrated into parked source ${target.spec.id} with reviewed provenance.`;
  target.next = `Integrated reviewed isolated contribution ${source.spec.id}; resume the retained selected block with fresh source-run evidence.`;
  event(target, 'integration-finalized', source.spec.id);
  event(source, 'integration-finalized', target.spec.id);
  writeRun(source);
  writeRun(target);
  return target;
}

function verifiedContribution(source: Run, parkHead: string, sourceHead: string, project: string): ExternalContribution {
  const before: CheckoutState = { head: parkHead, branch: undefined, files: source.baseline, modes: source.baselineModes ?? {} };
  if (!source.baselineModes) throw new Error(`Isolated run ${source.spec.id} lacks baseline Git mode provenance; reconcile it before integration`);
  const after = checkoutState(project);
  const commits = captureCommand(['git', 'rev-list', '--reverse', `${parkHead}..${sourceHead}`], project).trim().split(/\s+/).filter(Boolean);
  if (!commits.length) throw new Error(`Isolated run ${source.spec.id} has no committed contribution`);
  const closed = source.blocks.filter(block => block.status === 'closed');
  const delta = changedCheckoutFiles(before, after);
  const invalid = delta.filter(filename => !closed.some(block => matchesClosedCheckpoint(block, filename, after)));
  if (invalid.length) throw new Error(`Isolated run ${source.spec.id} has unreviewed hash, mode or deletion delta: ${invalid.join(', ')}`);
  const commitFiles = commits.flatMap(commit => captureCommand(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], project).split(/\r?\n/).filter(Boolean));
  const unknown = [...new Set(commitFiles.filter(filename => !closed.some(block => scopeMatches(filename, source.spec.blocks.find(specification => specification.id === block.id)!.scope))))];
  if (unknown.length) throw new Error(`Isolated run ${source.spec.id} has committed paths outside reviewed checkpoints: ${unknown.join(', ')}`);
  return { sourceRun: source.spec.id, sourceSpecDigest: source.specDigest, reviewedCheckpoints: closed.map(block => block.id), commits, before, after, recordedAt: new Date().toISOString() };
}

function applyContribution(state: CheckoutState, contribution: ExternalContribution): CheckoutState {
  const files = { ...state.files };
  const modes = { ...state.modes };
  for (const filename of changedCheckoutFiles(contribution.before, contribution.after)) {
    if (contribution.after.files[filename] === undefined) delete files[filename]; else files[filename] = contribution.after.files[filename]!;
    if (contribution.after.modes[filename] === undefined) delete modes[filename]; else modes[filename] = contribution.after.modes[filename]!;
  }
  return { head: state.head, branch: state.branch, files, modes };
}

function contributionPresent(state: CheckoutState, contribution: ExternalContribution): boolean {
  return changedCheckoutFiles(contribution.before, contribution.after).every(filename => state.files[filename] === contribution.after.files[filename] && state.modes[filename] === contribution.after.modes[filename]);
}

function markPending(source: Run, target: Run, detail: string): void {
  source.link!.crossProject!.integration = 'pending';
  const successor = target.isolatedSuccessors?.find(entry => entry.project === source.project && entry.run === source.spec.id);
  if (successor) successor.status = 'closed-pending-integration';
  source.next = detail;
  writeRun(source);
  writeRun(target);
}

function partialPaths(project: string): Set<string> {
  return new Set(['--cached', ''].flatMap(argument => captureCommand(['git', 'diff', ...(argument ? [argument] : []), '--name-only', '-z'], project).split('\0').filter(Boolean)).concat(captureCommand(['git', 'ls-files', '--others', '--exclude-standard', '-z'], project).split('\0').filter(Boolean)));
}

function indexDigest(project: string): string { return digest(captureCommand(['git', 'diff', '--cached', '--binary'], project)); }
function sameState(left: CheckoutState, right: CheckoutState): boolean { return left.head === right.head && left.branch === right.branch && !changedCheckoutFiles(left, right).length; }
function head(project: string): string { return requiredHead(captureCommand(['git', 'rev-parse', '--revs-only', 'HEAD'], project).trim(), 'Git checkout has no HEAD'); }
function requiredHead(value: string | undefined, message: string): string { if (!value) throw new Error(message); return value; }
function isAncestor(project: string, ancestor: string, descendant: string): boolean { return captureCommand(['git', 'merge-base', ancestor, descendant], project).trim() === ancestor; }
function commonGitDirectory(project: string, other: string): string {
  const directory = realpathSync(path.resolve(project, captureCommand(['git', 'rev-parse', '--git-common-dir'], project).trim()));
  const otherDirectory = realpathSync(path.resolve(other, captureCommand(['git', 'rev-parse', '--git-common-dir'], other).trim()));
  if (directory !== otherDirectory) throw new Error('Source and isolated directories are not Git worktrees of the same repository');
  return directory;
}
