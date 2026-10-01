import { event, promoteRecoveryRecord, requireAuthorization } from './lifecycle.ts';
import { digest } from './project.ts';
import { listRuns, readRun } from './store.ts';
import { assertAutoRecoveryPolicy } from './schema.ts';
import type { AutoRecoveryPolicy, RecoveryBudget, RecoveryGrant, RecoveryPolicyAdoption, RecoveryState, Run } from './types.ts';

interface RecoveryAuthorizationInput {
  owner: string;
  specDigest: string;
  revision: string;
  additionalCorrections: number;
  authorization: { kind: 'user'; reference: string; message: string; specDigest: string };
}

interface RecoveryAdoptionInput {
  owner: string;
  specDigest: string;
  revision: string;
  policy: AutoRecoveryPolicy;
  authorization: { kind: 'user'; reference: string; message: string; specDigest: string };
}

export function recoveryBudget(run: Run): RecoveryBudget {
  const owner = recoveryOwner(run);
  const family = recoveryFamily(run, owner.record);
  const used = family.reduce((total, member) => total + member.blocks.reduce((rounds, block) => rounds + block.rounds.length, 0), 0);
  const effective = effectivePolicy(owner.record, owner.state);
  const initial = effective.policy ? effective.policy.maxCorrections : recoveryLimit(owner.record, owner.state);
  const granted = effective.policy ? 0 : grantTotal(owner.state?.grants ?? []);
  if (initial !== undefined && initial > Number.MAX_SAFE_INTEGER - granted) throw new Error('Recovery grants exceed the largest safe correction limit');
  const limit = effective.policy ? initial : initial === undefined ? undefined : initial + granted;
  return {
    owner: owner.record.spec.id,
    specDigest: owner.specDigest,
    revision: revision(owner.record, owner.specDigest, owner.state, family),
    limit,
    used,
    remaining: limit === undefined ? undefined : Math.max(0, limit - used),
    ...(effective.policy ? { policy: effective.policy } : {}),
    policySource: effective.source,
  };
}

export function authorizeRecovery(run: Run, value: unknown): Run {
  requireAuthorization(run);
  const input = recoveryAuthorization(value);
  const budget = recoveryBudget(run);
  if (budget.policy) throw new Error('Auto recovery policy changes require recovery adopt with actual user authorization');
  if (input.owner !== budget.owner || input.specDigest !== budget.specDigest || input.authorization.specDigest !== budget.specDigest) throw new Error('Recovery authorization owner or specification does not match the durable policy');
  const owner = recoveryOwnerRecord(run, budget.owner);
  const state = owner.recovery;
  const prior = state?.grants?.find(grant => grant.authorization.reference === input.authorization.reference);
  if (prior) {
    if (sameGrant(prior, input)) return owner;
    throw new Error('Recovery authorization reference was already used with different evidence');
  }
  if (input.revision !== budget.revision) throw new Error('Recovery authorization revision is stale; inspect the current recovery budget');
  if (budget.limit !== undefined && budget.limit > Number.MAX_SAFE_INTEGER - input.additionalCorrections) throw new Error('Recovery grant exceeds the largest safe correction limit');
  const adoptedUsed = state?.adoptedUsed ?? (budget.limit === undefined ? budget.used : undefined);
  const initialLimit = state?.initialLimit ?? budget.limit;
  const nextGrant: RecoveryGrant = { additionalCorrections: input.additionalCorrections, authorization: input.authorization };
  owner.recovery = state
    ? { ...state, grants: [...(state.grants ?? []), nextGrant] }
    : { owner: budget.owner, specDigest: budget.specDigest, grants: [nextGrant], ...(initialLimit === undefined ? {} : { initialLimit }), ...(adoptedUsed === undefined ? {} : { adoptedUsed }) };
  promoteRecoveryRecord(owner, 3);
  event(owner, 'recovery-authorize', `${input.authorization.reference}: +${input.additionalCorrections} corrections`);
  return owner;
}

export function adoptRecoveryPolicy(run: Run, value: unknown): Run {
  requireAuthorization(run);
  const input = recoveryAdoption(value);
  const budget = recoveryBudget(run);
  if (input.owner !== budget.owner || input.specDigest !== budget.specDigest || input.authorization.specDigest !== budget.specDigest) throw new Error('Recovery adoption owner or specification does not match the durable policy');
  const owner = recoveryOwnerRecord(run, budget.owner);
  const prior = owner.recovery?.adoptions?.find(adoption => adoption.authorization.reference === input.authorization.reference);
  if (prior) {
    if (sameAdoption(prior, input)) return owner;
    throw new Error('Recovery adoption authorization reference was already used with different evidence');
  }
  if (input.revision !== budget.revision) throw new Error('Recovery adoption revision is stale; inspect the current recovery budget');
  const state = owner.recovery;
  const adoption: RecoveryPolicyAdoption = { policy: input.policy, authorization: input.authorization, at: new Date().toISOString() };
  const initialLimit = state?.initialLimit ?? (owner.spec.recovery?.mode === 'auto' ? undefined : owner.spec.recovery?.maxCorrections);
  owner.recovery = {
    owner: budget.owner,
    specDigest: budget.specDigest,
    ...(initialLimit === undefined ? {} : { initialLimit }),
    ...(state?.grants ? { grants: state.grants } : { grants: [] }),
    ...(state?.adoptedUsed === undefined ? {} : { adoptedUsed: state.adoptedUsed }),
    policy: input.policy,
    policySource: 'adoption',
    adoptions: [...(state?.adoptions ?? []), adoption],
  };
  promoteRecoveryRecord(owner, 4);
  event(owner, 'recovery-adopt', `${input.authorization.reference}: ${input.policy.maxCorrections === undefined ? 'auto' : `auto/${input.policy.maxCorrections}`}`);
  return owner;
}

function recoveryOwner(run: Run): { record: Run; specDigest: string; state?: RecoveryState } {
  if (run.recovery) return durableOwner(run, run.recovery);
  const ancestor = recoveryAncestor(run);
  if (ancestor) return ancestor;
  return { record: run, specDigest: run.specDigest };
}

function recoveryOwnerRecord(run: Run, owner: string): Run {
  return run.spec.id === owner ? run : readRun(run.project, owner);
}

function durableOwner(run: Run, state: RecoveryState): { record: Run; specDigest: string; state?: RecoveryState } {
  const owner = recoveryOwnerRecord(run, state.owner);
  if (owner.spec.id !== state.owner || owner.recovery?.owner !== state.owner || owner.recovery.specDigest !== state.specDigest) throw new Error('Recovery owner record no longer matches its durable policy identity');
  return { record: owner, specDigest: state.specDigest, state: owner.recovery };
}

function recoveryAncestor(run: Run): { record: Run; specDigest: string; state?: RecoveryState } | undefined {
  const seen = new Set<string>([run.spec.id]);
  let current = run;
  while (current.roadmapOrigin) {
    const origin = current.roadmapOrigin;
    if (seen.has(origin.parentRun)) throw new Error('Recovery roadmap ancestry is cyclic');
    seen.add(origin.parentRun);
    const parent = readRun(run.project, origin.parentRun);
    if (parent.recovery) return durableOwner(parent, parent.recovery);
    if (parent.spec.recovery && (parent.spec.recovery.mode !== 'auto' || !parent.roadmapOrigin)) return { record: parent, specDigest: parent.specDigest };
    current = parent;
  }
  return current === run ? undefined : { record: current, specDigest: current.specDigest };
}

function recoveryFamily(run: Run, owner: Run): Run[] {
  const records = new Map(listRuns(run.project).map(record => [record.spec.id, record]));
  records.set(run.spec.id, run);
  return [...records.values()].filter(record => belongsToOwner(record, owner, records));
}

function belongsToOwner(record: Run, owner: Run, records: Map<string, Run>): boolean {
  if (record.spec.id === owner.spec.id) return true;
  const policyDigest = owner.recovery?.specDigest ?? owner.specDigest;
  if (record.recovery?.owner === owner.spec.id && record.recovery.specDigest === policyDigest) return true;
  const seen = new Set<string>([record.spec.id]);
  let current = record;
  while (current.roadmapOrigin) {
    const origin = current.roadmapOrigin;
    if (seen.has(origin.parentRun)) return false;
    seen.add(origin.parentRun);
    const parent = records.get(origin.parentRun);
    if (!parent) return false;
    if (parent.spec.id === owner.spec.id) return true;
    current = parent;
  }
  return false;
}

function effectivePolicy(owner: Run, state: RecoveryState | undefined): { policy?: AutoRecoveryPolicy; source: 'legacy' | 'spec' | 'adoption' } {
  if (state?.policy) return { policy: state.policy, source: state.policySource ?? 'adoption' };
  if (owner.spec.recovery?.mode === 'auto') return { policy: owner.spec.recovery, source: 'spec' };
  return { source: 'legacy' };
}

function recoveryLimit(owner: Run, state: RecoveryState | undefined): number | undefined {
  if (state?.initialLimit !== undefined) return state.initialLimit;
  if (!owner.spec.recovery) return state?.adoptedUsed;
  return owner.spec.recovery.maxCorrections;
}

function grantTotal(grants: RecoveryGrant[]): number {
  return grants.reduce((total, grant) => {
    if (total > Number.MAX_SAFE_INTEGER - grant.additionalCorrections) throw new Error('Recovery grants exceed the largest safe correction limit');
    return total + grant.additionalCorrections;
  }, 0);
}

function revision(owner: Run, specDigest: string, state: RecoveryState | undefined, family: Run[]): string {
  const members = [...family].sort((left, right) => left.spec.id.localeCompare(right.spec.id));
  return digest(JSON.stringify({ owner: owner.spec.id, specDigest, grants: state?.grants ?? [], policy: state?.policy, policySource: state?.policySource, adoptions: state?.adoptions ?? [], family: members.map(member => ({ id: member.spec.id, specDigest: member.specDigest, failures: member.blocks.flatMap(block => block.failure ? [[block.id, block.failure]] : []), rounds: member.blocks.flatMap(block => block.rounds.map((round, position) => [block.id, position, round.signature, round.at])), control: member.recoveryControl })) }));
}

function recoveryAuthorization(value: unknown): RecoveryAuthorizationInput {
  const input = recoveryInput(value, 'authorization');
  if (!positive(input.additionalCorrections)) throw new Error('Recovery authorization is malformed');
  return { ...input, additionalCorrections: input.additionalCorrections };
}

function recoveryAdoption(value: unknown): RecoveryAdoptionInput {
  const input = recoveryInput(value, 'policy');
  assertAutoRecoveryPolicy(input.policy, 'Recovery adoption requires an auto policy with an optional positive correction limit: ');
  return { ...input, policy: input.policy };
}

function recoveryInput(value: unknown, requiredField: 'authorization' | 'policy'): Record<string, unknown> & { owner: string; specDigest: string; revision: string; authorization: { kind: 'user'; reference: string; message: string; specDigest: string } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Recovery ${requiredField === 'policy' ? 'adoption' : 'authorization'} must be an object`);
  const input = value as Record<string, unknown>;
  const permitted = requiredField === 'policy' ? ['owner', 'specDigest', 'revision', 'policy', 'authorization'] : ['owner', 'specDigest', 'revision', 'additionalCorrections', 'authorization'];
  if (Object.keys(input).some(key => !permitted.includes(key)) || !identifier(input.owner) || !hash(input.specDigest) || !hash(input.revision)) throw new Error(`Recovery ${requiredField === 'policy' ? 'adoption' : 'authorization'} is malformed`);
  const authorization = input.authorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) throw new Error('Recovery authorization needs actual user evidence bound to the recovery specification');
  const user = authorization as Record<string, unknown>;
  if (Object.keys(user).some(key => !['kind', 'reference', 'message', 'specDigest'].includes(key)) || user.kind !== 'user' || !text(user.reference) || !text(user.message) || !hash(user.specDigest)) throw new Error('Recovery authorization needs actual user evidence bound to the recovery specification');
  return { ...input, owner: input.owner, specDigest: input.specDigest, revision: input.revision, authorization: { kind: 'user', reference: user.reference, message: user.message, specDigest: user.specDigest } };
}

function sameGrant(grant: RecoveryGrant, input: RecoveryAuthorizationInput): boolean {
  return grant.additionalCorrections === input.additionalCorrections && grant.authorization.reference === input.authorization.reference && grant.authorization.message === input.authorization.message && grant.authorization.specDigest === input.authorization.specDigest;
}

function sameAdoption(adoption: RecoveryPolicyAdoption, input: RecoveryAdoptionInput): boolean {
  return adoption.policy.mode === input.policy.mode && adoption.policy.maxCorrections === input.policy.maxCorrections && adoption.authorization.reference === input.authorization.reference && adoption.authorization.message === input.authorization.message && adoption.authorization.specDigest === input.authorization.specDigest;
}

function identifier(value: unknown): value is string { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function text(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
