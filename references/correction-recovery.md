# Correction recovery

Read this guide for an actual correction, strategy checkpoint, policy adoption or exhausted explicit limit. Ordinary execution uses [execution](execution.md); interrupted processes, parking and native access use [runtime recovery](runtime-recovery.md).

## Inspect the existing authority

Run `oso-codex recovery status` in the task project, optionally with `--run ID`. It returns the durable `owner`, `specDigest`, `revision`, `used`, effective `policy` when AUTO applies, `policySource`, and `limit`/`remaining` when finite; it also reports the selected `run`, `block`, `failureKey`, `pause`, `canCorrect` and `canVerify`. Copy returned identities rather than calculating them. Reading does not migrate or unblock a run.

New approved AUTO work uses `recovery: {"mode":"auto"}`. Omit a numeric ceiling unless the user actually sets one. AUTO continues within the authorized scope while progress, diagnosis and the quality bar justify the next correction. An explicit `{"mode":"auto","maxCorrections":N}` remains a binding total limit; historical grants do not add to that AUTO ceiling. The legacy `{"maxCorrections":N}` policy remains finite, and an absent policy retains its legacy behavior until explicitly adopted.

New AUTO roadmap descendants share the root owner. A preexisting durable finite child owner keeps its own binding limit until that owner is explicitly adopted; adopting the root does not silently override it. Independent work while A is parked has its own authority. Every accepted correction records one whole repaired cycle, not one unit per file, finding, agent or check. Reopening, amendment, parking, resume and replacement agents preserve this history. Invalid arguments, failed preparation, status queries and reused evidence do not spend a correction. Initial reproduction and a linked native permission retry retain their separate rules.

Zero remaining prevents another corrective cycle after a new failure. It permits completing the checks and review of the last authorized cycle and closing when every criterion passes. It never makes stale evidence, unresolved findings or a blocked delivery current.

| Pause | Next action |
|---|---|
| `budget` | Inspect applicable authority: adopt AUTO, revise an explicitly authorized AUTO ceiling, or extend a finite policy through the corresponding operation below. |
| `stagnation` | Autonomously diagnose the actual cause and record a changed strategy before editing or retrying; this is not a request for more correction units. |
| `decision` | Resolve the material decision and record its actual approved amendment. |
| `native-access` | Inspect the linked native error and use the legitimate permission route for that command. |

More than one condition can remain: repeat status after resolving one. A grant does not clear another pause, code failure, permission episode or delivery boundary. Read-only diagnosis, native result delivery, handle reconciliation and recovery authorization remain available during a pause. Never disable the plugin, edit runtime JSON or replace the run to continue the same failed scope.

## Adopt or revise AUTO

On resume, inspect the actual current task authorization, applicable standing instructions and any later constraints. Existing authority that covers AUTO continuation or adoption can authorize this operation without another user question. Cite that real instruction and its scope; do not infer blanket authority from an old approval, another operator's preference, or the word AUTO alone. Preserve newer explicit correction, time and money limits, NORMAL decision boundaries, other-host constraints, and all native permissions and delivery boundaries. Ask only for authority that is actually missing.

Read current status immediately before `oso-codex recovery adopt --file -`, then supply:

```json
{
  "owner": "returned-policy-owner",
  "specDigest": "returned-policy-digest",
  "revision": "returned-current-recovery-revision",
  "policy": { "mode": "auto" },
  "authorization": {
    "kind": "user",
    "reference": "actual-native-user-message-reference",
    "message": "The actual instruction covering this policy adoption",
    "specDigest": "returned-policy-digest"
  }
}
```

Include `policy.maxCorrections` when preserving an explicit ceiling. A later change to an AUTO ceiling uses this same adoption operation with applicable actual authority, not a finite grant. Adoption binds the owner, specification and current revision, preserves the original spec, used corrections, grants, approvals, findings and relationships, and records the effective policy separately. Exact replay returns the current state without another event; replaying an older adoption never restores its old policy over a newer explicit limit. Conflicting or stale submissions fail without mutation. Reconcile an uncertain result before resubmitting.

## Diagnose and correct

Under AUTO, two corrections without qualifying relevant progress require a real diagnosis and changed strategy before another correction. Continue that diagnosis autonomously within existing authority. Reevaluate earlier when the approach has no supported prospect of progress; two further corrections without progress after a strategy require reevaluation. A strategy permits a diagnosed attempt but is not itself progress. Legacy finite/absent policies retain their existing third-correction checkpoint until adopted.

Reuse the actual principal when it has sufficient capacity and context; preserve the model selected by the operator. If a child is useful, reuse a capable existing agent or follow [model selection and escalation](execution.md#model-selection-and-escalation). Reconcile its actual native delivered result before recording a strategy. A launched agent, an unavailable model or `--escalated` alone is not diagnosis evidence. An incomplete result needs a directed follow-up, not successive replacement agents.

Pass this shape through `oso-codex recovery strategy --file -`, using the current block and failure key:

```json
{
  "block": "actual-active-block",
  "failureKey": "returned-failure-key",
  "diagnosis": {
    "agent": "actual-principal-or-delivered-native-agent-id",
    "report": "The actual causal diagnosis and its supported conclusion",
    "evidence": ["Relevant source location, check attempt/log or delivered finding"]
  },
  "approach": "The concrete repair strategy justified by that diagnosis"
}
```

The runtime binds it to the unresolved failure and round. Child evidence requires a delivered native agent for this block at least at its implementation tier; the preserved native report may differ in wording from the principal's synthesis. An old child delivery cannot be relabeled as fresh diagnosis. Do not invent identities, results or evidence to satisfy a field.

AUTO progress must address the affected block's required behavior: an intact required check moving from `fail`/`reproduced` to `pass`, or the evidenced resolution of an existing finding. Repeating a green check, reusing a pass, rewording a report, relabeling a failure or replaying an operation earns no new credit. A later check regression invalidates its credit; reopening a finding revokes its credit without deleting history. Oscillating back to an earlier good state does not create fresh progress.

When the implicated required check is demonstrably improving but still fails, the strategy's optional `progress` object accepts `beforeAttempt`, `afterAttempt`, `metric`, numeric `before` and `after`, and an `evidence` list. Use intact chronological logs of that same completed check and command, with nonnegative values and a strict decrease. Keep the metric comparable and explain the measured evidence. Credit requires a new best value across the retained history, not merely an improvement from the latest regression; changing the metric or replaying an attempt cannot reset that comparison. The runtime does not infer semantic improvement from a number.

After readiness permits correction, repair the cause and record any finding resolution. Prefer `check ID --retry --evidence TEXT`; for a measured infrastructure/delivery repair add `--measured TEXT`. Standalone `retry --evidence TEXT` remains supported. The combined command records recovery and prepares the affected check atomically. Use `--escalated` only as truthful historical annotation, never as a substitute for the recorded strategy. Run affected checks and request directed confirmation from the same reviewer; reuse current evidence and stop once the required bar passes.

## Authorize finite continuation

For a retained finite policy, `recovery authorize` adds explicitly authorized units. Prefer AUTO adoption when existing authority covers it; do not repeatedly request small finite grants to imitate an already authorized AUTO workflow. When a finite extension is the actual authorized choice, state its exact additional amount, causal strategy and remaining work. A user's “go” can authorize that concrete proposal. Reuse applicable existing authority; a general historical approval is not unlimited recovery authority.

Immediately before submission, read `recovery status` again because strategy, progress or another family member can change its revision. Submit `oso-codex recovery authorize --file -`:

```json
{
  "owner": "returned-budget-owner",
  "specDigest": "returned-policy-digest",
  "revision": "returned-current-recovery-revision",
  "additionalCorrections": 2,
  "authorization": {
    "kind": "user",
    "reference": "actual-native-user-message-reference",
    "message": "The user's actual instruction authorizing this finite continuation",
    "specDigest": "returned-policy-digest"
  }
}
```

The amount above is an example, not a default grant. This adds units to the owner without clearing the failure or changing the approved product scope. Exact replay is idempotent; a stale revision or incompatible reuse of authority is rejected without mutation. Reconcile an uncertain result once before another submission. The runtime records supplied authority; native user messages and faithful principal behavior establish whether it is real.

## Legacy continuation and shared memory

Existing v1–v4 runs remain readable and writable under their retained policy. Without an explicit policy they keep the historical three-correction block limit; existing finite policies keep their limits and grants until explicitly adopted. A finite grant remains supported: for a legacy unbounded-spec run it preserves used rounds and adds only authorized units, so three consumed plus two additional means a limit of five. It does not convert the run to AUTO, rewrite its specification or fabricate an earlier grant. Inspect status after either operation for remaining readiness conditions.

Legacy recovery policy/control uses v3. New AUTO semantics and explicit external fulfillment provenance require v4 with minimum reader v4; either may exist without the other. Coordination, requested configuration, contributions and observations require v5 with minimum reader v5. Promotions are monotonic and only a new create, authorized amendment or supported reconciliation is atomic promotion; reading, installation and ordinary legacy writes do not migrate projects. Preserve IDs, baselines, approvals, checks, findings, native handles and parked/roadmap relationships. Older readers must reject unsupported records; reinstalling an older payload does not downgrade them. After an update, preserve the continuation and open a fresh Codex thread with the compatible payload.

At semantic checkpoints, update the existing [Engram](engram.md) plan/index/summary with owner, effective policy/source, any explicit limit, used corrections, remaining allowance when finite, recovery revision, pause, actual strategy and `NEXT:`. Carry the adoption authority and later constraints into a fresh-thread handoff. The local runtime retains execution authority and evidence; stale memory cannot replace its policy, renew a budget or clear a failure.
