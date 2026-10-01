import { captureCommand } from './command.ts';
import { activateBlock, authorize, matchesRoadmapAuthority, startRun } from './lifecycle.ts';
import { recordReviewedContribution, resumeParkedRun } from './parking.ts';
import { digest } from './project.ts';
import { reconcile } from './recovery.ts';
import { childSatisfiesRoadmap, hasValidRoadmapLineage } from './roadmap-lineage.ts';
import { listRuns, readRun, selectRun, transaction, writeRun } from './store.ts';
import type { Run, RunSpec } from './types.ts';

export function selectRoadmapChild(project: string, parentId: string | undefined, childId: string): Run {
  const initial = selection(project, parentId, childId);
  if (!initial.child) {
    requireDependencies(initial.parent, initial.specification, initial.children);
    startRun(project, initial.specification, { deferSelection: true, roadmapParent: initial.parent.spec.id });
  }
  return transaction(project, () => finalizeSelection(project, parentId, childId));
}

function finalizeSelection(project: string, parentId: string | undefined, childId: string): Run {
  const current = selection(project, parentId, childId);
  const { parent, specification, children, child } = current;
  for (const sibling of children.filter(entry => entry.status === 'running')) reconcile(sibling);
  const active = children.filter(entry => ['running', 'blocked'].includes(entry.status));
  if (active.some(entry => entry.spec.id !== childId)) throw new Error(`Roadmap child ${active.map(entry => entry.spec.id).join(', ')} remains active; reconcile its native handles instead of replacing the executor`);
  const parkedSiblings = children.filter(entry => entry.status === 'parked' && entry.spec.id !== childId);
  if (parkedSiblings.length && captureCommand(['git', 'status', '--porcelain=v1'], project).trim()) throw new Error(`Parked roadmap child ${parkedSiblings.map(entry => entry.spec.id).join(', ')} has partial work; use the isolated worktree route before selecting a sibling`);
  if (!child) throw new Error(`Child ${childId} was not durably created; preserve the current selector and reconcile the interrupted start`);
  assertChild(parent, specification, child);
  if (child.status === 'closed') {
    selectRun(parent);
    return parent;
  }
  requireDependencies(parent, specification, children);
  if (child.status === 'pending-approval') {
    authorize(child, { kind: 'roadmap', parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id });
    activateBlock(child, child.blocks[0]!.id);
  } else if (child.status === 'parked') {
    const completed = children.filter(entry => entry.spec.id !== child.spec.id && entry.status === 'closed' && entry.baseHead === child.parked?.checkout.head);
    if (completed.length && captureCommand(['git', 'status', '--porcelain=v1'], project).trim()) throw new Error(`Parked roadmap child ${childId} needs the isolated worktree route before absorbing a reviewed sibling contribution`);
    for (const sibling of terminalContributions(completed)) recordReviewedContribution(child, sibling);
    resumeParkedRun(child);
  }
  for (const sibling of children.filter(entry => entry.status === 'running' && entry.spec.id !== child.spec.id)) writeRun(sibling);
  writeRun(child);
  selectRun(child);
  return child;
}

function selection(project: string, parentId: string | undefined, childId: string): { parent: Run; specification: RunSpec; children: Run[]; child?: Run } {
  const parent = readRun(project, parentId);
  if (parent.spec.mode !== 'roadmap' || !parent.approval || parent.status === 'closed' || digest(JSON.stringify(parent.spec)) !== parent.specDigest) throw new Error('Select an approved unchanged unfinished roadmap parent before choosing a child');
  const specification = parent.spec.children?.find(child => child.id === childId);
  if (!specification) throw new Error('Select an exact child id from the approved roadmap');
  const childIds = new Set(parent.spec.children?.map(child => child.id) ?? []);
  const selected = readRun(project);
  if (selected.spec.id !== parent.spec.id && !childIds.has(selected.spec.id) && selected.status !== 'closed') throw new Error(`Selected run ${selected.spec.id} is unrelated and remains active; --run cannot displace it`);
  const children = listRuns(project).filter(run => childIds.has(run.spec.id));
  for (const record of children) assertChild(parent, parent.spec.children!.find(entry => entry.id === record.spec.id)!, record);
  const child = children.find(entry => entry.spec.id === childId);
  return { parent, specification, children, child };
}

function assertChild(parent: Run, specification: RunSpec, child: Run): void {
  const authority = { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id };
  const originalDigest = digest(JSON.stringify(specification));
  const lineage = child.roadmapLineage;
  if (child.roadmapOrigin && !matchesRoadmapAuthority(child.roadmapOrigin, authority)) throw new Error('Existing child origin no longer matches the approved roadmap');
  if (lineage && (!hasValidRoadmapLineage(child) || lineage.baseline.parentRun !== authority.parentRun || lineage.baseline.parentDigest !== authority.parentDigest || lineage.baseline.child !== authority.child || lineage.baseline.originalSpecDigest !== originalDigest)) throw new Error('Existing child lineage no longer matches the approved roadmap');
  if (child.specDigest !== originalDigest && !lineage) throw new Error('Existing child no longer matches the approved roadmap; reconcile the material amendment');
  if (child.status === 'pending-approval' && !matchesRoadmapAuthority(child.roadmapOrigin, authority)) throw new Error('Pending child lacks its exact durable roadmap origin; reconcile its original parent and baseline');
  if (child.status !== 'pending-approval' && child.approval?.kind === 'roadmap' && !matchesRoadmapAuthority(child.approval, authority)) throw new Error('Existing child authority no longer matches the approved roadmap');
  if (child.status !== 'pending-approval' && child.approval?.kind === 'user' && child.approval.specDigest !== child.specDigest) throw new Error('Existing child user authorization no longer matches its amended roadmap specification');
}

function requireDependencies(parent: Run, specification: RunSpec, children: Run[]): void {
  for (const dependency of specification.dependsOn ?? []) {
    const record = children.find(child => child.spec.id === dependency);
    const original = parent.spec.children?.find(child => child.id === dependency);
    if (!record || !original || record.status !== 'closed' || !childSatisfiesRoadmap(parent, original, record)) throw new Error(`Roadmap child dependency remains incomplete: ${dependency}`);
  }
}

function terminalContributions(children: Run[]): Run[] {
  const embedded = new Set(children.flatMap(child => child.externalContributions?.map(contribution => contribution.sourceRun) ?? []));
  return children.filter(child => !embedded.has(child.spec.id));
}
