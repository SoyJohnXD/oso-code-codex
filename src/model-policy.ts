import type { ModelConfiguration, Tier } from './types.ts';

export function tierRank(tier: Tier): number {
  const index = ['luna', 'terra', 'astra'].indexOf(tier);
  if (index === -1) throw new Error(`Unknown model tier: ${tier}`);
  return index;
}

export function configurationTier(configuration: ModelConfiguration | undefined): Tier | undefined {
  if (!configuration) return undefined;
  if (configuration.model === 'gpt-5.6-luna') return 'luna';
  if (configuration.model === 'gpt-5.6-terra') return 'terra';
  if (configuration.model === 'gpt-6-astra') return 'astra';
  return undefined;
}

export function sameConfiguration(left: ModelConfiguration | undefined, right: ModelConfiguration | undefined): boolean {
  return left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort && left?.forkTurns === right?.forkTurns;
}

export function sameModelConfiguration(left: ModelConfiguration | undefined, right: ModelConfiguration | undefined): boolean {
  return left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort;
}

export function configurationCovers(reviewer: ModelConfiguration | undefined, implementation: ModelConfiguration | undefined): boolean {
  if (!reviewer || !implementation) return false;
  const reviewerTier = configurationTier(reviewer);
  const implementationTier = configurationTier(implementation);
  if (reviewerTier && implementationTier) return tierRank(reviewerTier) >= tierRank(implementationTier);
  return sameModelConfiguration(reviewer, implementation);
}
