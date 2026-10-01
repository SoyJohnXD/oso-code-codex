export type Mode = 'plan' | 'roadmap' | 'quick' | 'debug' | 'quality-pass';
export type FailureKind = 'product' | 'infrastructure' | 'delivery' | 'decision';
export type Tier = 'luna' | 'terra' | 'astra';
export type BoundaryAction = 'commit' | 'publication';
export interface Boundary {
  status: 'open' | 'resolved';
  cause: string;
  rounds: { evidence: string; escalated: boolean; at: string }[];
  integration?: IntegrationBoundary;
  completion?: CompletedIntegrationReceipt;
}

export interface IntegrationBoundary {
  sourceRun: string;
  sourceSpecDigest: string;
  commits: string[];
  beforeHead: string;
  afterHead: string;
}

export interface CompletedIntegrationReceipt {
  kind: 'completed-integration';
  sourceRun: string;
  sourceSpecDigest: string;
  commits: string[];
  beforeHead: string;
  afterHead: string;
  verifiedHead: string;
  evidence: string;
  at: string;
}
export interface RoadmapAuthority { parentRun: string; parentDigest: string; child: string }
export interface RoadmapBaseline extends RoadmapAuthority { originalSpecDigest: string }
export type RoadmapCompatibility = 'additive' | 'replacement';
export interface RoadmapAmendment {
  fromDigest: string;
  toDigest: string;
  authorization: Extract<Approval, { kind: 'user' }>;
  compatibility: RoadmapCompatibility;
  at: string;
  provenance: 'amend' | 'legacy-reconcile';
}
export interface RoadmapLineage {
  baseline: RoadmapBaseline;
  amendments: RoadmapAmendment[];
}
export type Approval =
  | { kind: 'user'; reference: string; message: string; specDigest: string }
  | ({ kind: 'roadmap' } & RoadmapAuthority);

export type RecoverySpec = { mode?: undefined; maxCorrections: number } | AutoRecoveryPolicy;
export interface AutoRecoveryPolicy { mode: 'auto'; maxCorrections?: number }
export interface RecoveryGrant {
  additionalCorrections: number;
  authorization: Extract<Approval, { kind: 'user' }>;
}
export interface RecoveryState {
  owner: string;
  specDigest: string;
  initialLimit?: number;
  grants?: RecoveryGrant[];
  adoptedUsed?: number;
  policy?: AutoRecoveryPolicy;
  policySource?: 'spec' | 'adoption';
  adoptions?: RecoveryPolicyAdoption[];
}
export interface RecoveryPolicyAdoption {
  policy: AutoRecoveryPolicy;
  authorization: Extract<Approval, { kind: 'user' }>;
  at: string;
}
export interface RecoveryBudget {
  owner: string;
  specDigest: string;
  revision: string;
  limit: number | undefined;
  used: number;
  remaining: number | undefined;
  policy?: AutoRecoveryPolicy;
  policySource: 'legacy' | 'spec' | 'adoption';
}
export interface RecoveryStrategy {
  block: string;
  failureKey: string;
  round: number;
  diagnosis: { agent: string; report: string; evidence: string[]; delivery?: { at: string; report: string } };
  approach: string;
  progress?: { beforeAttempt: string; afterAttempt: string; metric: string; before: number; after: number; evidence: string[] };
  at: string;
}
export type RecoveryProgress =
  | { kind: 'check'; attempt: string; block: string; round: number; at: string; revokedAt?: string }
  | { kind: 'finding'; id: string; evidence: string; resolution: string; block: string; round: number; at: string; revokedAt?: string };
export type RecoveryProgressInput =
  | { kind: 'check'; attempt: string }
  | { kind: 'finding'; id: string };
export interface RecoveryControl {
  strategies: RecoveryStrategy[];
  progress: RecoveryProgress[];
}
export interface RecoveryPause {
  kind: 'budget' | 'stagnation' | 'decision' | 'native-access';
  reason: string;
  next: string;
}
export interface RecoveryStatus extends RecoveryBudget {
  run: string;
  block?: string;
  failureKey?: string;
  pause?: RecoveryPause;
  canCorrect: boolean;
  canVerify: boolean;
}

export interface CheckSpec {
  id: string;
  command: string[];
  cwd?: string;
  inputs: string[];
  envKeys?: string[];
  pathMode?: 'lookup' | 'literal';
  resources?: string[];
  timeoutMs?: number;
}

export interface BlockSpec {
  id: string;
  goal: string;
  scope: string[];
  criteria: string[];
  checks: string[];
  dependsOn?: string[];
  review?: 'general' | 'security' | 'design';
}

export interface RunSpec {
  id: string;
  mode: Mode;
  objective: string;
  principal: string;
  checks: CheckSpec[];
  blocks: BlockSpec[];
  decisions: string[];
  recovery?: RecoverySpec;
  coordination?: { maxActiveAgents: number };
  reviewFallback?: ModelConfiguration;
  children?: RunSpec[];
  dependsOn?: string[];
  publication?: boolean;
}

export interface ModelConfiguration {
  model: string;
  reasoningEffort: string;
  forkTurns?: 'none';
}

export type Snapshot = Record<string, string>;

export interface CheckResult {
  id: string;
  attempt: string;
  block: string;
  command: string[];
  cwd: string;
  fingerprint: string;
  started: string;
  finished?: string;
  status: 'running' | 'pass' | 'fail' | 'blocked' | 'interrupted' | 'stale' | 'reproduced';
  exitCode?: number | null;
  signal?: string | null;
  log: string;
  logDigest?: string;
  diagnostics: string[];
  blocker?: 'permission' | 'environment';
  permissionEpisode?: string;
  runner: ProcessIdentity;
  child?: ProcessIdentity;
}

export type CheckRecovery =
  | { kind: 'correction'; evidence: string; measured?: string; escalated?: boolean }
  | { kind: 'permission'; evidence: string };

export interface ProcessIdentity { pid: number; start?: string; namespace?: string }

export interface Review {
  id: string;
  agent: string;
  tier?: Tier;
  kind: 'general' | 'security' | 'design';
  scopeDigest: string;
  scopeModes?: Snapshot;
  checkAttempts: string[];
  criteria: string[];
  verdict: 'pass' | 'findings' | 'blocked';
  report: string;
  reportDigest: string;
  coverage?: { requested?: ModelConfiguration; observed?: ModelConfiguration; fallback?: ModelConfiguration };
}

export interface ImplementationContribution {
  actor: string;
  scope: string[];
  evidence: string;
  configuration?: ModelConfiguration;
  at: string;
}

export interface Finding {
  id: string;
  rule: string;
  evidence: string;
  disposition: 'open' | 'fixed' | 'false-positive';
  resolution?: string;
}

export interface BlockState {
  id: string;
  status: 'pending' | 'active' | 'closed' | 'blocked';
  baseline?: Snapshot;
  baselineModes?: Snapshot;
  closedSnapshot?: Snapshot;
  closedModes?: Snapshot;
  closedDeletions?: string[];
  externalFulfillment?: ExternalFulfillment;
  externalFulfillments?: ExternalFulfillment[];
  writers: string[];
  implementationTier?: Tier;
  contributions?: ImplementationContribution[];
  unattributedWriters?: string[];
  reviews: Review[];
  findings: Finding[];
  rounds: { kind: FailureKind; cause: string; evidence: string; escalated: boolean; signature: string; at: string }[];
  failure?: { kind: FailureKind; cause: string; signature: string; approvalDigest: string; checkAttempt?: string };
  permissionEpisodes?: Record<string, { id: string; recovery?: { evidence: string; at: string } }>;
}

export interface ExternalFulfillmentInput {
  block: string;
  targetSpecDigest: string;
  sourceRun: string;
  sourceSpecDigest: string;
  sourceBlocks: string[];
  evidence: string;
}

export interface ExternalFulfillment extends Omit<ExternalFulfillmentInput, 'block'> {
  sourceProject: string;
  contributionDigest: string;
  sourceEvidenceDigest: string;
  acceptanceReviewId: string;
  at: string;
}

export interface AgentRecord {
  id: string;
  block: string;
  role: 'applier' | 'reviewer' | 'explorer';
  tier?: Tier;
  scope: string[];
  status: 'running' | 'finished' | 'uncertain';
  result?: string;
  deliveries?: { at: string; report: string }[];
  failureKey?: string;
  requestedConfiguration?: ModelConfiguration;
  observedConfiguration?: ModelConfiguration;
  observations?: { at: string; configuration: ModelConfiguration }[];
  replacementFor?: string;
  assignments?: { at: string; block: string; scope: string[]; requestedConfiguration?: ModelConfiguration; observedConfiguration?: ModelConfiguration; replacementFor?: string }[];
}

export interface CheckoutState {
  head?: string;
  branch?: string;
  files: Snapshot;
  modes: Snapshot;
}

export interface ParkedState {
  reason: string;
  at: string;
  previousStatus: 'running' | 'blocked';
  selectedBlock?: string;
  globalBaseline: Snapshot;
  checkout: CheckoutState;
  evidence: { checks: string[]; reviews: string[]; failures: string[] };
  recoveryBudgets: Record<string, { rounds: number; blocked: boolean; permissionEpisodes: string[] }>;
  handles: { checks: string[]; agents: string[] };
  untouchedSelectionPending?: boolean;
}

export interface ExternalContribution {
  sourceRun: string;
  sourceSpecDigest: string;
  reviewedCheckpoints: string[];
  commits: string[];
  before: CheckoutState;
  after: CheckoutState;
  recordedAt: string;
}

export interface RunLink {
  parkedRun: string;
  kind: 'parked-successor';
  createdAt: string;
  crossProject?: CrossProjectLink;
}

export interface CrossProjectLink {
  sourceProject: string;
  sourceRun: string;
  commonDirectory: string;
  parkHead: string;
  integration?: 'pending' | 'integrated';
}

export interface IsolatedSuccessor {
  project: string;
  run: string;
  commonDirectory: string;
  parkHead: string;
  status: 'starting' | 'active' | 'closed-pending-integration' | 'integrated';
}

export interface IntegrationIntent {
  sourceProject: string;
  sourceRun: string;
  sourceSpecDigest: string;
  checkpoints: string[];
  commits: string[];
  before: CheckoutState;
  after: CheckoutState;
  beforeIndexDigest: string;
  expectedIndexDigest: string;
  createdAt: string;
}

export interface Run {
  version: 1 | 2 | 3 | 4 | 5;
  project: string;
  spec: RunSpec;
  specDigest: string;
  approval?: Approval;
  roadmapOrigin?: RoadmapAuthority;
  roadmapLineage?: RoadmapLineage;
  created: string;
  updated: string;
  status: 'pending-approval' | 'running' | 'blocked' | 'parked' | 'closed';
  activeBlock?: string;
  baseline: Snapshot;
  baselineModes?: Snapshot;
  baseHead?: string;
  blocks: BlockState[];
  checks: CheckResult[];
  agents: AgentRecord[];
  principalObservations?: { at: string; configuration: ModelConfiguration }[];
  finalReviews: Review[];
  next: string;
  imports: { source: string; digest: string; at: string }[];
  events: { at: string; action: string; detail: string }[];
  boundaries?: Partial<Record<BoundaryAction, Boundary>>;
  adoptions?: { files: Snapshot; modes: Snapshot; authorization: Extract<Approval, { kind: 'user' }>; at: string }[];
  readerMinimumVersion?: 2 | 3 | 4 | 5;
  recovery?: RecoveryState;
  recoveryControl?: RecoveryControl;
  parked?: ParkedState;
  link?: RunLink;
  externalContributions?: ExternalContribution[];
  selectionAmendment?: { retainedBlock: string; pending: true };
  isolatedSuccessors?: IsolatedSuccessor[];
  integrationIntent?: IntegrationIntent;
}
