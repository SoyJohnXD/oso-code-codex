import { changedFiles } from './project.ts';
import type { CheckoutState, Run } from './types.ts';

export function changedCheckoutFiles(before: CheckoutState, after: CheckoutState): string[] {
  return [...new Set([...changedFiles(before.files, after.files), ...changedFiles(before.modes, after.modes)])].sort();
}

export function matchesClosedCheckpoint(block: Run['blocks'][number], filename: string, after: CheckoutState): boolean {
  const present = block.closedSnapshot && Object.hasOwn(block.closedSnapshot, filename) && block.closedModes && Object.hasOwn(block.closedModes, filename);
  const deleted = block.closedDeletions?.includes(filename) && !Object.hasOwn(block.closedSnapshot ?? {}, filename) && !Object.hasOwn(block.closedModes ?? {}, filename);
  return Boolean(present && block.closedSnapshot![filename] === after.files[filename] && block.closedModes![filename] === after.modes[filename] || deleted && !Object.hasOwn(after.files, filename) && !Object.hasOwn(after.modes, filename));
}
