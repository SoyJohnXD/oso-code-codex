import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { captureCommand } from './command.ts';
import { relatedRuns } from './checks.ts';
import { matchesClosedCheckpoint } from './contributions.ts';
import { event, promoteRecoveryRecord } from './lifecycle.ts';
import { tierRank } from './model-policy.ts';
import { checkoutState } from './parking.ts';
import { digest, insideProject, scopeMatches } from './project.ts';
import { closeBlock, coversScope, currentBlockReview } from './reviews.ts';
import { readRun, stateDirectory } from './store.ts';
import type { BlockSpec, BlockState, ExternalContribution, ExternalFulfillment, ExternalFulfillmentInput, Run } from './types.ts';

export function closeExternalBlock(run: Run, value: unknown): boolean {
  const input = fulfillmentInput(value);
  const block = run.blocks.find(entry => entry.id === input.block);
  const specification = run.spec.blocks.find(entry => entry.id === input.block);
  if (!block || !specification || input.targetSpecDigest !== run.specDigest || digest(JSON.stringify(run.spec)) !== run.specDigest) throw new Error('External fulfillment target block or specification is stale or unknown');
  const imported = run.externalContributions?.filter(entry => entry.sourceRun === input.sourceRun && entry.sourceSpecDigest === input.sourceSpecDigest) ?? [];
  if (imported.length !== 1) throw new Error('External fulfillment requires one already imported source contribution');
  const contribution = imported[0]!;
  const source = fulfillmentSource(run, input.sourceRun);
  if (source.specDigest !== input.sourceSpecDigest || digest(JSON.stringify(source.spec)) !== source.specDigest || source.status !== 'closed' || source.activeBlock || source.blocks.some(entry => entry.status !== 'closed')) throw new Error('External fulfillment source identity, specification or closed checkpoints no longer match');
  const checkpoints = input.sourceBlocks.map(id => sourceCheckpoint(source, contribution, id));
  assertContributionCommits(run, contribution);
  assertCheckpointCoverage(run, specification, contribution, checkpoints);
  const provenance = { ...input, sourceProject: source.project, contributionDigest: digest(JSON.stringify(contribution)), sourceEvidenceDigest: digest(JSON.stringify(checkpoints)) };
  if (block.status === 'closed') {
    const prior = block.externalFulfillment;
    if (!prior || !sameFulfillment(prior, provenance) || currentBlockReview(run, block, specification).id !== prior.acceptanceReviewId) throw new Error('External fulfillment conflicts with the closed checkpoint or its current acceptance evidence');
    return false;
  }
  if (run.activeBlock !== input.block || block.externalFulfillments?.some(entry => sameMapping(entry, input))) throw new Error('External fulfillment requires the selected block and a mapping that has not been reopened');
  const candidate = structuredClone(run);
  const acceptance = closeBlock(candidate);
  const fulfilled = candidate.blocks.find(entry => entry.id === input.block)!;
  const { block: selectedBlock, ...metadata } = provenance;
  const recorded: ExternalFulfillment = { ...metadata, acceptanceReviewId: acceptance.id, at: new Date().toISOString() };
  fulfilled.externalFulfillment = recorded;
  (fulfilled.externalFulfillments ??= []).push(recorded);
  promoteRecoveryRecord(candidate, 4);
  event(candidate, 'external-fulfillment', `${selectedBlock}: ${source.spec.id}/${input.sourceBlocks.join(',')}`);
  Object.assign(run, candidate);
  delete run.activeBlock;
  return true;
}

function fulfillmentInput(value: unknown): ExternalFulfillmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('External fulfillment mapping must be an object');
  const input = value as Record<string, unknown>;
  const identifier = (entry: unknown): entry is string => typeof entry === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry);
  const hash = (entry: unknown): entry is string => typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry);
  if (Object.keys(input).some(key => !['block', 'targetSpecDigest', 'sourceRun', 'sourceSpecDigest', 'sourceBlocks', 'evidence'].includes(key)) || !identifier(input.block) || !identifier(input.sourceRun) || !hash(input.targetSpecDigest) || !hash(input.sourceSpecDigest) || !Array.isArray(input.sourceBlocks) || !input.sourceBlocks.length || !input.sourceBlocks.every(identifier) || new Set(input.sourceBlocks).size !== input.sourceBlocks.length || typeof input.evidence !== 'string' || !input.evidence.trim()) throw new Error('External fulfillment mapping requires exact block, specification, source checkpoints and rationale');
  return { block: input.block, targetSpecDigest: input.targetSpecDigest, sourceRun: input.sourceRun, sourceSpecDigest: input.sourceSpecDigest, sourceBlocks: [...input.sourceBlocks], evidence: input.evidence };
}

function fulfillmentSource(run: Run, id: string): Run {
  const isolated = run.isolatedSuccessors?.filter(entry => entry.run === id) ?? [];
  const local = existsSync(path.join(stateDirectory(run.project), 'runs', `${id}.json`));
  if (isolated.length + Number(local) !== 1) throw new Error('External fulfillment source must resolve uniquely from the retained run links');
  const forward = isolated[0];
  if (forward && (forward.status !== 'integrated' || run.integrationIntent?.sourceRun === id)) throw new Error('External fulfillment requires completed isolated integration');
  const source = readRun(forward?.project ?? run.project, id);
  if (source.link?.parkedRun !== run.spec.id) throw new Error('External fulfillment source is not the linked successor of this target');
  const cross = source.link.crossProject;
  if (forward ? !cross || cross.sourceProject !== run.project || cross.sourceRun !== run.spec.id || cross.integration !== 'integrated' || cross.commonDirectory !== forward.commonDirectory || cross.parkHead !== forward.parkHead : Boolean(cross)) throw new Error('External fulfillment source links do not prove completed integration');
  return source;
}

function sourceCheckpoint(source: Run, contribution: ExternalContribution, id: string) {
  const block = source.blocks.find(entry => entry.id === id);
  const specification = source.spec.blocks.find(entry => entry.id === id);
  if (!block || !specification || !contribution.reviewedCheckpoints.includes(id) || block.status !== 'closed' || !block.closedSnapshot || !block.closedModes || !block.closedDeletions || block.failure || block.findings.some(entry => entry.disposition === 'open')) throw new Error(`External fulfillment source checkpoint ${id} lacks complete closed evidence`);
  const review = block.reviews.findLast(entry => entry.verdict === 'pass' && entry.kind === (specification.review ?? 'general') && specification.criteria.every(criterion => entry.criteria.includes(criterion)) && entry.scopeDigest === digest(JSON.stringify(block.closedSnapshot)) && digest(JSON.stringify(entry.scopeModes)) === digest(JSON.stringify(block.closedModes)) && entry.agent !== source.spec.principal && !block.writers.includes(entry.agent) && (block.contributions ? Boolean(entry.coverage) : Boolean(entry.tier && tierRank(entry.tier) >= tierRank(block.implementationTier ?? 'luna'))));
  if (!review || digest(readFileSync(review.report)) !== review.reportDigest) throw new Error(`External fulfillment source checkpoint ${id} needs an intact independent review`);
  const agent = source.agents.find(entry => entry.id === review.agent);
  if (!agent || agent.role !== 'reviewer' || agent.status !== 'finished' || !agent.deliveries?.some(delivery => digest(delivery.report) === review.reportDigest)) throw new Error(`External fulfillment source checkpoint ${id} lacks its delivered native review`);
  const history = relatedRuns(source).flatMap(record => record.checks);
  const checks = specification.checks.map(checkId => {
    const configured = source.spec.checks.find(check => check.id === checkId);
    return configured && history.findLast(check => check.id === checkId && check.status === 'pass' && review.checkAttempts.includes(check.attempt) && JSON.stringify(check.command) === JSON.stringify(configured.command) && check.cwd === insideProject(source.project, configured.cwd ?? '.'));
  });
  if (checks.some(check => !check || !check.logDigest || digest(readFileSync(check.log)) !== check.logDigest)) throw new Error(`External fulfillment source checkpoint ${id} has missing or altered check logs`);
  return { specification, block, review, checks };
}

function assertContributionCommits(run: Run, contribution: ExternalContribution): void {
  const before = contribution.before.head;
  const after = contribution.after.head;
  if (!before || !after || !/^[a-f0-9]{40,64}$/.test(before) || !/^[a-f0-9]{40,64}$/.test(after) || !contribution.commits.length) throw new Error('External fulfillment contribution lacks its committed before/after interval');
  if (captureCommand(['git', 'merge-base', before, after], run.project).trim() !== before) throw new Error('External fulfillment contribution does not descend from its recorded before head');
  const commits = captureCommand(['git', 'rev-list', '--reverse', `${before}..${after}`], run.project).trim().split(/\s+/).filter(Boolean);
  if (JSON.stringify(commits) !== JSON.stringify(contribution.commits)) throw new Error('External fulfillment contribution commit interval no longer matches its recorded commits');
  if (captureCommand(['git', 'merge-base', after, 'HEAD'], run.project).trim() !== after) throw new Error('External fulfillment contribution is not an ancestor of the current target HEAD');
}

function assertCheckpointCoverage(run: Run, target: BlockSpec, contribution: ExternalContribution, checkpoints: { specification: BlockSpec; block: BlockState }[]): void {
  const scopes = checkpoints.flatMap(entry => entry.specification.scope);
  if (!target.scope.every(requested => scopes.some(assigned => coversScope(assigned, requested)))) throw new Error('External fulfillment source checkpoints do not cover the complete target scope');
  const current = checkoutState(run.project);
  const targetBlock = run.blocks.find(entry => entry.id === target.id)!;
  const known = new Set([...Object.keys(run.baseline), ...Object.keys(targetBlock.baseline ?? {}), ...Object.keys(current.files), ...Object.keys(contribution.before.files), ...Object.keys(contribution.after.files), ...checkpoints.flatMap(entry => [...Object.keys(entry.block.closedSnapshot!), ...entry.block.closedDeletions!])]);
  const paths = [...known].filter(filename => scopeMatches(filename, target.scope));
  if (!target.scope.every(pattern => paths.some(filename => scopeMatches(filename, [pattern])))) throw new Error('External fulfillment needs explicit checkpoint evidence for every target scope');
  if (paths.some(filename => !checkpoints.some(entry => scopeMatches(filename, entry.specification.scope) && matchesClosedCheckpoint(entry.block, filename, contribution.after) && matchesClosedCheckpoint(entry.block, filename, current)))) throw new Error('External fulfillment target files, Git modes or explicit deletions differ from the selected source checkpoints');
}

function sameFulfillment(prior: ExternalFulfillment, current: Omit<ExternalFulfillment, 'acceptanceReviewId' | 'at'>): boolean {
  return sameMapping(prior, current) && prior.sourceProject === current.sourceProject && prior.contributionDigest === current.contributionDigest && prior.sourceEvidenceDigest === current.sourceEvidenceDigest;
}

function sameMapping(prior: ExternalFulfillment, current: Omit<ExternalFulfillmentInput, 'block'>): boolean {
  return prior.targetSpecDigest === current.targetSpecDigest && prior.sourceRun === current.sourceRun && prior.sourceSpecDigest === current.sourceSpecDigest && JSON.stringify(prior.sourceBlocks) === JSON.stringify(current.sourceBlocks) && prior.evidence === current.evidence;
}
