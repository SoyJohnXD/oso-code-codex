import { existsSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { captureCommand } from './command.ts';
import { blockBoundary, resolveBoundary, resolveCompletedIntegrationBoundary } from './boundaries.ts';
import { parseArgs } from 'node:util';
import { executeCheck, validCheck } from './checks.ts';
import { hookDecision, type HookInput } from './hooks.ts';
import { activateBlock, activeBlock, adoptPreservedWork, authorize, event, importLegacy, newBlockState, startRun } from './lifecycle.ts';
import { amendUntouchedSelection, parkRun, resumeParkedRun, startFromParkedRun, transitionStatus } from './parking.ts';
import { integrateIsolatedRun, startIsolatedRun } from './isolated.ts';
import { closeExternalBlock } from './external-fulfillment.ts';
import { confirmMemoryDelivery, pendingMemory, queueMemory } from './memory.ts';
import { selectRoadmapChild } from './roadmap.ts';
import { applyRoadmapAmendment, reconcileRoadmapChild, retainLegacyWriterAttribution } from './roadmap-lineage.ts';
import { digest, projectRoot } from './project.ts';
import { confirmStoppedCheck, reconcile, recordFailure, retry } from './recovery.ts';
import { adoptRecoveryPolicy, authorizeRecovery, recoveryBudget } from './recovery-policy.ts';
import { recordRecoveryStrategy, recoveryStatus } from './recovery-control.ts';
import { closeBlock, closeRun, currentBlockReview, finishAgent, recordContribution, recordObservation, recordReview, registerAgent, upsertFinding } from './reviews.ts';
import { parseSpec } from './schema.ts';
import { readRun, selectRun, stateDirectory, transaction, writeRun } from './store.ts';
import type { AgentRecord, Approval, BoundaryAction, CheckRecovery, FailureKind, Finding, Review, Run, Snapshot, Tier } from './types.ts';

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    file: { type: 'string' }, authorization: { type: 'string' }, project: { type: 'string' },
    run: { type: 'string' }, child: { type: 'string' }, block: { type: 'string' }, agent: { type: 'string' }, report: { type: 'string' },
    verdict: { type: 'string' }, criteria: { type: 'string' }, tier: { type: 'string' }, kind: { type: 'string' },
    cause: { type: 'string' }, evidence: { type: 'string' }, measured: { type: 'string' }, next: { type: 'string' },
    all: { type: 'boolean' }, final: { type: 'boolean' }, escalated: { type: 'boolean' }, full: { type: 'boolean' }, help: { type: 'boolean' },
    'all-criteria': { type: 'boolean' }, finish: { type: 'boolean' },
    'stopped-check': { type: 'string' },
    action: { type: 'string' }, resolved: { type: 'boolean' }, 'completed-integration': { type: 'string' },
    red: { type: 'boolean' },
    retry: { type: 'boolean' }, 'retry-permission': { type: 'boolean' },
    reason: { type: 'string' }, transitions: { type: 'boolean' }, 'from-run': { type: 'string' }, 'from-project': { type: 'string' },
  } });
  const command = positionals[0] ?? 'help';
  if (command === 'help' || values.help) { output(help); return; }
  if (command === 'hook') {
    const decision = hookDecision(JSON.parse(readFileSync(0, 'utf8')) as HookInput);
    output(JSON.stringify(decision.allow ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } }));
    return;
  }
  if (command === 'diagnostic') {
    output(JSON.stringify({ node: process.version, codex: captureCommand(['codex', '--version'], process.cwd()).trim(), state: 'project/.oso-code-codex (local, git-ignored)', models: 'User-selected principal. Oso delegates substantial work with explicit Luna/max and scoped context. Terra/high and Astra/high require the evidence and conditions in references/execution.md#model-selection-and-escalation. Independent new work starts at Luna; review covers escalated implementation. This is instruction-led routing, not a runtime launch gate.', integrations: 'Engram stores shared plans, decisions and progress through native MCP. Other integrations preserve their criteria with equivalent evidence. No permissions or model settings are modified.' }, null, 2));
    return;
  }
  const project = projectRoot(values.project ?? process.cwd());
  if (command === 'recovery') {
    const action = positionals[1];
    if (action === 'status') {
      output(JSON.stringify(recoveryStatus(readRun(project, values.run)), null, 2));
      return;
    }
    if (action !== 'authorize' && action !== 'strategy' && action !== 'adopt') throw new Error('Choose recovery status, recovery strategy --file -, recovery authorize --file - or recovery adopt --file -');
    transaction(project, () => {
      const selected = readRun(project);
      const run = values.run ? readRun(project, values.run) : selected;
      if (action === 'strategy') {
        assertSelectedMutation(project, run, values.run);
        recordRecoveryStrategy(run, jsonFile(required(values.file, '--file')));
        writeRun(run);
        output(JSON.stringify(recoveryStatus(run), null, 2));
        return;
      }
      if (run.spec.id !== selected.spec.id && recoveryBudget(selected).owner !== run.spec.id) throw new Error('Recovery authorization must target the selected run or its approved budget owner');
      if (action === 'adopt') {
        const owner = adoptRecoveryPolicy(run, jsonFile(required(values.file, '--file')));
        if (JSON.stringify(owner) !== JSON.stringify(readRun(project, owner.spec.id))) writeRun(owner);
        output(JSON.stringify(recoveryStatus(readRun(project, run.spec.id)), null, 2));
        return;
      }
      const owner = authorizeRecovery(run, jsonFile(required(values.file, '--file')));
      if (JSON.stringify(owner) !== JSON.stringify(readRun(project, owner.spec.id))) writeRun(owner);
      output(JSON.stringify(recoveryStatus(readRun(project, run.spec.id)), null, 2));
    });
    return;
  }
  if (command === 'memory') {
    const action = positionals[1];
    if (!['pending', 'queue', 'delivered'].includes(action ?? '')) throw new Error('Choose memory pending, queue or delivered');
    const result = action === 'pending' ? pendingMemory(project, values.full) : action === 'queue' ? queueMemory(project, jsonFile(required(values.file, '--file'))) : confirmMemoryDelivery(project, jsonFile(required(values.file, '--file')));
    output(JSON.stringify(action === 'queue' ? { ...result, content: undefined, superseded: undefined } : result, null, 2));
    return;
  }
  if (command === 'status' && values.transitions) {
    output(JSON.stringify(transitionStatus(project, values.run), null, 2));
    return;
  }
  if (command === 'status' && !values.run && !existsSync(path.join(stateDirectory(project), 'active'))) {
    output(JSON.stringify({ status: 'not-started', next: 'Start the authorized task once with spec and authorization files.' }));
    return;
  }
  if (command === 'roadmap') {
    if (positionals[1] !== 'reconcile') throw new Error('Choose roadmap reconcile --run PARENT --child CHILD');
    const child = reconcileRoadmapChild(project, required(values.run, '--run'), required(values.child, '--child'));
    printStatus(child, values.full);
    return;
  }
  if (command === 'child') {
    const child = selectRoadmapChild(project, values.run, required(positionals[1], 'child id'));
    printStatus(child, values.full);
    return;
  }
  if (command === 'start') {
    const specification = specificationFile(required(values.file, '--file'));
    if (values['from-run'] && !values.authorization) throw new Error('A parked successor requires its own actual user authorization');
    if (values['from-project'] && !values['from-run']) throw new Error('--from-project requires --from-run');
    const run = values['from-project'] ? startIsolatedRun(project, projectRoot(values['from-project']), values['from-run']!, specification) : values['from-run'] ? startFromParkedRun(project, readRun(project, values['from-run']), specification) : startRun(project, specification);
    if (values.authorization) transaction(project, () => {
      authorize(run, approvalFile(values.authorization!, run.specDigest));
      activateBlock(run, run.blocks[0]!.id);
      writeRun(run);
    });
    printStatus(run, values.full);
    return;
  }
  if (command === 'integrate') {
    if (!values['from-run'] || !values['from-project']) throw new Error('integrate requires --from-run and --from-project');
    const run = integrateIsolatedRun(project, projectRoot(values['from-project']), values['from-run']);
    printStatus(run, values.full);
    return;
  }
  if (command === 'check') {
    const recovering = values.retry || values['retry-permission'];
    if (recovering && (values.all || values.red || (values.retry && values['retry-permission']))) throw new Error('Choose one recovery for one check ID; recovery cannot use --all or --red');
    if (values['retry-permission'] && (values.measured || values.escalated)) throw new Error('Permission recovery uses native authorization evidence, not --measured or --escalated');
    if (!recovering && (values.evidence || values.measured || values.escalated)) throw new Error('Check recovery evidence requires --retry or --retry-permission');
    const recovery: CheckRecovery | undefined = values.retry
      ? { kind: 'correction', evidence: required(values.evidence, '--evidence'), measured: values.measured, escalated: values.escalated }
      : values['retry-permission'] ? { kind: 'permission', evidence: required(values.evidence, '--evidence') } : undefined;
    const ids = values.all ? activeBlock(readRun(project)).specification.checks : [required(positionals[1], 'check id or --all')];
    for (const id of ids) {
      const result = await executeCheck(project, id, values.red, recovery);
      output(JSON.stringify(result.status === 'pass' ? result : { ...result, next: readRun(project).next }));
      if (result.status !== 'pass') { process.exitCode = 2; break; }
    }
    return;
  }
  if (command === 'resume' && values['stopped-check']) {
    const run = readRun(project, values.run);
    confirmStoppedCheck(run, values['stopped-check'], required(values.evidence, '--evidence'));
    transaction(project, () => { writeRun(run); selectRun(run); });
    printStatus(run, values.full);
    return;
  }
  if (command === 'resume') {
    transaction(project, () => {
      const run = readRun(project, values.run);
      if (run.status === 'parked') resumeParkedRun(run);
      else {
        assertSelectedMutation(project, run, values.run);
        reconcile(run);
      }
      selectRun(run);
      writeRun(run);
      printStatus(run, values.full);
    });
    return;
  }
  transaction(project, () => {
    const run = readRun(project, values.run);
    if (command !== 'status') assertSelectedMutation(project, run, values.run);
    if (!['plan', 'roadmap'].includes(run.spec.mode)) values.final = false;
    switch (command) {
      case 'status': printStatus(run, values.full); return;
      case 'park': parkRun(run, required(values.reason, '--reason')); break;
      case 'authorize': authorize(run, approvalFile(required(values.file, '--file'), run.specDigest)); break;
      case 'activate': activateBlock(run, required(values.block ?? positionals[1], 'block id')); break;
      case 'reopen': {
        const id = required(values.block, '--block');
        const block = run.blocks.find(entry => entry.id === id);
        if (run.status === 'closed' || !block || block.status !== 'closed' || run.activeBlock) throw new Error('Reopen a closed block within an unfinished run; recovery budgets are preserved');
        block.status = 'active';
        delete block.externalFulfillment;
        activateBlock(run, id);
        event(run, 'reopen', id);
        break;
      }
      case 'agent': registerAgent(run, jsonFile(required(values.file, '--file')) as Omit<AgentRecord, 'status' | 'block'>, values.final); break;
      case 'delivered': finishAgent(run, required(values.agent, '--agent'), textFile(required(values.report, '--report'))); break;
      case 'contribution': recordContribution(run, jsonFile(required(values.file, '--file'))); break;
      case 'observation': recordObservation(run, jsonFile(required(values.file, '--file'))); break;
      case 'review': {
        const agent = required(values.agent, '--agent');
        const verdict = required(values.verdict, '--verdict');
        if (values.finish && verdict !== 'pass') throw new Error('--finish requires a passing review; record findings or blockers without closure');
        const kind = values.kind ?? 'general';
        if (!['pass', 'findings', 'blocked'].includes(verdict) || !['general', 'security', 'design'].includes(kind)) throw new Error('Invalid semantic review verdict or dimension');
        if (!run.agents.some(entry => entry.id === agent)) {
          const truthful = values.final ? run.blocks.some(block => block.contributions) : Boolean(activeBlock(run).block.contributions);
          if (truthful) throw new Error('Truthful reviews require a registered native reviewer configuration; use agent --file before review');
          registerAgent(run, { id: agent, role: 'reviewer', tier: (values.tier ?? 'luna') as Tier, scope: values.final ? run.spec.blocks.flatMap(block => block.scope) : activeBlock(run).specification.scope }, values.final);
        }
        finishAgent(run, agent, textFile(required(values.report, '--report')));
        const criteria = values['all-criteria'] ? (values.final ? ['rubric', 'conformance'] : activeBlock(run).specification.criteria) : required(values.criteria, '--criteria or --all-criteria').split(',');
        recordReview(run, { agent, verdict: verdict as Review['verdict'], kind: kind as Review['kind'], criteria }, values.final);
        if (values.finish) {
          if (values.final) closeRun(run);
          else {
            closeBlock(run);
            if (!['plan', 'roadmap'].includes(run.spec.mode)) closeRun(run);
          }
        }
        break;
      }
      case 'finding': upsertFinding(run, jsonFile(required(values.file, '--file')) as Finding); break;
      case 'failure': {
        const kind = required(values.kind, '--kind');
        if (!['product', 'infrastructure', 'delivery', 'decision'].includes(kind)) throw new Error('Invalid failure kind');
        recordFailure(run, kind as FailureKind, required(values.cause, '--cause'));
        break;
      }
      case 'retry': retry(run, required(values.evidence, '--evidence'), values.escalated ?? false, values.measured); break;
      case 'checkpoint': {
        if (!values.file) closeBlock(run);
        else if (!closeExternalBlock(run, jsonFile(values.file))) { printStatus(run, values.full); return; }
        break;
      }
      case 'close': closeRun(run); break;
      case 'note': run.next = required(values.next, '--next'); event(run, 'checkpoint-note', run.next); break;
      case 'boundary': {
        const action = required(values.action, '--action');
        if (!['commit', 'publication'].includes(action)) throw new Error('Delivery boundary action must be commit or publication');
        if (values['completed-integration']) {
          if (action !== 'commit' || !values.resolved || values.escalated) throw new Error('--completed-integration requires boundary --action commit --resolved and cannot use --escalated');
          resolveCompletedIntegrationBoundary(run, values['completed-integration'], required(values.evidence, '--evidence'));
        } else if (values.resolved) resolveBoundary(run, action as BoundaryAction, required(values.evidence, '--evidence'), values.escalated ?? false);
        else blockBoundary(run, action as BoundaryAction, required(values.cause, '--cause'));
        break;
      }
      case 'import': importLegacy(run, required(values.file, '--file')); break;
      case 'adopt': {
        const document = jsonFile(required(values.file, '--file')) as { files: Snapshot };
        adoptPreservedWork(run, document.files, approvalFile(required(values.authorization, '--authorization'), run.specDigest));
        break;
      }
      case 'amend': {
        const specification = specificationFile(required(values.file, '--file'));
        if (specification.id !== run.spec.id || run.status === 'closed' || !run.roadmapOrigin && run.blocks.some(block => !specification.blocks.some(entry => entry.id === block.id))) throw new Error('Amendments preserve run and block identities, findings and budgets');
        if (JSON.stringify(specification.recovery) !== JSON.stringify(run.spec.recovery)) throw new Error('Amendments preserve the recovery policy; use recovery authorize for a finite additional budget');
        const approval = approvalFile(required(values.authorization, '--authorization'), digest(JSON.stringify(specification)));
        if (approval.kind !== 'user' || approval.specDigest !== digest(JSON.stringify(specification)) || !approval.message?.trim() || !approval.reference?.trim()) throw new Error('Material amendments require actual user authorization for the new specification');
        const untouchedSelection = amendUntouchedSelection(run, specification);
        if (run.roadmapOrigin) applyRoadmapAmendment(run, readRun(project, run.roadmapOrigin.parentRun), specification, approval);
        else {
          event(run, 'amend-from', JSON.stringify(run.spec));
          for (const block of specification.blocks) if (!run.blocks.some(entry => entry.id === block.id)) run.blocks.push(newBlockState(block.id, specification));
          run.spec = specification;
          run.specDigest = approval.specDigest;
          run.approval = approval;
          if (specification.coordination || specification.reviewFallback) {
            run.version = 5;
            run.readerMinimumVersion = 5;
            retainLegacyWriterAttribution(run);
          }
        }
        if (untouchedSelection) run.next = 'The former selection remains parked and untouched; resume, then activate the inserted prerequisite.';
        break;
      }
      default: throw new Error(`Unknown command: ${command}. Run oso-codex help.`);
    }
    writeRun(run);
    printStatus(run, values.full);
  });
}

let standardInput: string | undefined;

function textFile(filename: string): string {
  if (filename !== '-') return readFileSync(filename, 'utf8');
  return standardInput ??= readFileSync(0, 'utf8');
}

function jsonFile(filename: string): unknown { return JSON.parse(textFile(filename)); }

function specificationFile(filename: string) {
  const submitted = jsonFile(filename) as Record<string, unknown>;
  return parseSpec(bindPrincipal((submitted.specification ?? submitted) as Record<string, unknown>, process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID));
}

function bindPrincipal(specification: Record<string, unknown>, inherited: unknown): Record<string, unknown> {
  const principal = specification.principal ?? inherited;
  return { ...specification, principal, ...(Array.isArray(specification.children) ? { children: specification.children.map(child => bindPrincipal(child as Record<string, unknown>, principal)) } : {}) };
}

function approvalFile(filename: string, specDigest: string): Approval {
  const document = jsonFile(filename) as Record<string, unknown>;
  const submitted = (document.authorization ?? document) as Record<string, unknown>;
  return (submitted.kind === 'user' ? { ...submitted, specDigest: submitted.specDigest ?? specDigest } : submitted) as unknown as Approval;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`Missing ${name}; run oso-codex help`);
  return value;
}

function printStatus(run: Run, full = false): void {
  const cache = new Map();
  const currentChecks = run.spec.checks.map(check => {
    const evidence = validCheck(run, check.id, cache);
    const last = run.checks.findLast(result => result.id === check.id);
    return { id: check.id, evidence, refreshReason: !evidence && last?.status === 'pass' && !last.fingerprint.startsWith('v2:') ? 'Historical fingerprint lacks executable/helper provenance. Refresh this required check once in its existing block; preserve the old evidence and budget.' : undefined };
  });
  output(JSON.stringify(full ? { ...run, currentChecks } : {
    id: run.spec.id, mode: run.spec.mode, status: run.status, specDigest: run.specDigest, activeBlock: run.activeBlock,
    blocks: run.blocks.map(block => {
      const specification = run.spec.blocks.find(entry => entry.id === block.id)!;
      const historicalCoverage = block.reviews.findLast(review => review.verdict === 'pass')?.coverage;
      const currentCoverage = block.status === 'closed' ? { status: 'closed' } : (() => {
        try { return { status: 'satisfied', coverage: currentBlockReview(run, block, specification).coverage }; } catch (error) { return { status: 'pending', reason: error instanceof Error ? error.message : String(error) }; }
      })();
      return { id: block.id, status: block.status, rounds: block.rounds.length, findings: block.findings.filter(finding => finding.disposition === 'open').length, accounting: block.contributions ? { contributions: block.contributions.length, writers: block.writers, historicalCoverage, currentCoverage } : { model: 'legacy-unknown' } };
    }),
    modelAccounting: run.spec.coordination || run.spec.reviewFallback ? { requested: run.agents.map(agent => ({ id: agent.id, configuration: agent.requestedConfiguration })), observed: [...(run.principalObservations ?? []).map(observation => ({ id: run.spec.principal, configuration: observation.configuration })), ...run.agents.flatMap(agent => agent.observations?.map(observation => ({ id: agent.id, configuration: observation.configuration })) ?? [])], fallback: run.spec.reviewFallback } : { model: 'legacy-unknown' },
    checks: currentChecks.map(check => ({ id: check.id, valid: Boolean(check.evidence), last: check.evidence?.status ?? run.checks.findLast(result => result.id === check.id)?.status, attempt: check.evidence?.attempt, log: check.evidence?.log, refreshReason: check.refreshReason })),
    next: run.next,
    boundaries: run.boundaries,
    recovery: recoveryStatus(run),
  }, null, 2));
}

const help = `oso-codex — local Codex execution evidence (no permission overrides)

start --file - [--authorization -] [--from-run ID] [--from-project PATH]
                                                    Start an isolated successor from a parked dirty checkout
child ID [--run PARENT]                               Start/resume the exact approved child with inherited authority
roadmap reconcile --run PARENT --child CHILD           Promote one approved additive legacy child lineage
authorize --file approval.json                        Record actual user or approved roadmap authorization
activate BLOCK | reopen --block BLOCK                 Select work; reopening preserves recovery budgets
check ID | check --all                                Execute affected checks; reuse valid evidence
check ID --retry --evidence TEXT [--measured TEXT] [--escalated]
                                                    Record correction and execute in one operation
check ID --retry-permission --evidence TEXT           One native-authorized retry per access episode
agent --file - [--final]                Record a live native child handle; never spawn recursively
delivered --agent ID --report -                       Reconcile actual native prose from stdin
contribution --file -                                 Record actual principal or delivered applier implementation
observation --file -                                  Append observed native or principal model evidence
review --agent ID --report - --verdict pass|findings|blocked --criteria rubric,conformance,...
       [--all-criteria instead of --criteria] [--finish] [--tier luna|terra|astra] [--kind general|security|design] [--final]
finding --file -                                      Preserve each finding and its evidenced resolution
failure --kind product|infrastructure|delivery|decision --cause TEXT
retry --evidence TEXT [--measured TEXT] [--escalated]   Record one repaired cycle within approved recovery authority
recovery status [--run ID]                            Inspect the approved shared correction budget without writes
recovery strategy --file -                           Record actual directed diagnosis and a changed recovery approach
recovery authorize --file -                          Record a finite actual user-authorized budget extension
recovery adopt --file -                              Adopt or revise an AUTO policy with actual user authorization
checkpoint | close                                   Compute closure prerequisites; no manual green flag
checkpoint --file -                                  Close selected A block with explicit imported B checkpoint provenance
park --reason TEXT                                    Retain selected approved evidence before separate work
integrate --from-run ID --from-project PATH            Fast-forward a reviewed isolated successor into the parked source
resume [--run ID] | status [--full|--transitions]      Reconcile or read parked lifecycle eligibility without writes
note --next TEXT                                     Persist the next concrete action
boundary --action commit|publication --cause TEXT    Preserve a required external delivery blocker across slices
boundary --action ACTION --resolved --evidence TEXT [--escalated]
boundary --action commit --resolved --completed-integration RUN --evidence TEXT
amend --file - --authorization -  Material changes keep existing block identities
import --file LEGACY                                  Record read-only provenance; never import a green flag
adopt --file - --authorization -                     Record authorized preserved file paths and SHA256 hashes
diagnostic                                           Show runtime and host capabilities
memory pending [--full] | memory queue --file -       Inspect or retain undelivered Engram state with its revision
memory delivered --file -                            Remove only the exact acknowledged queue entry

All project commands accept --project PATH. Records/logs live in .oso-code-codex/.
JSON --file - and --report - read stdin; existing file arguments remain supported.
import reads an existing legacy file as provenance only.
start --file - --authorization - accepts {"specification": {...}, "authorization": {...}}.
Schemas and examples: references/runtime.md. Reviews accept ordinary native prose.
`;

main().catch(error => {
  writeSync(2, `oso-codex: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function output(message: string): void { writeSync(1, `${message}\n`); }

function assertSelectedMutation(project: string, run: Run, supplied?: string): void {
  if (!supplied) return;
  const active = path.join(stateDirectory(project), 'active');
  if (!existsSync(active) || readFileSync(active, 'utf8').trim() !== run.spec.id) throw new Error(`Run ${run.spec.id} is not selected; --run cannot mutate an unrelated run`);
}
