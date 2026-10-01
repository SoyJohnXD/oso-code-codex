# Runtime: oso-codex

Use the stable installed launcher `oso-codex` for routine execution. Only when it is unavailable or deliberately testing a source checkout, use `node <plugin-root>/dist/oso-codex.cjs`, copying the path from the loaded plugin. On `MODULE_NOT_FOUND`, compare the requested filename with the actual file once and correct a typo directly. If an update removed the old cache referenced by this thread, preserve the Engram continuation and open a fresh thread; do not recreate native cache files or keep retrying that missing path. The launcher performs no model requests, permission overrides or automatic agent launches. Run it with the task project as cwd, or `--project /absolute/project`. A stable path is not a permission grant; do not create blanket approval rules for this mutable runner, `node` or `check --all`.

The project must be a Git worktree (an unborn Git repository is supported). Technical records, logs and internal text reports live under `.oso-code-codex/`, ignored by its own nested `.gitignore`, so no global writable directory/profile is necessary. Shared plans, ledgers and summaries live in [Engram](engram.md). Only the principal mutates these records. For a subagent worktree, the principal invokes the runtime against the main project; record actual worktree/branch owners in notes and integrate before final checks.

Before any product edit, start or resume the authorized runtime. Reconstruct it only when its local record is unavailable, using the absolute project path, run id, literal Engram topic and actual approval reference. Planning has no future approval reference; bind it when approval or a valid resume supplies one. A base/position is useful recovery context only. If a required identity or authority is absent, retain the precise pending boundary instead of starting detached work.

## Start and authorize

Pass a compact JSON specification from the actual approved task through stdin. The CLI fills an omitted `principal` from the native `CODEX_THREAD_ID`/`CODEX_SESSION_ID`; no environment-wide scan is needed. There is no need to create a specification or approval file. This example assumes AUTO execution is authorized:

```json
{
  "id": "price-rounding",
  "mode": "quick",
  "objective": "Round the displayed total to cents",
  "principal": "actual-native-parent-session-id",
  "decisions": ["Preserve the existing currency and rounding contract"],
  "recovery": { "mode": "auto" },
  "checks": [{
    "id": "unit",
    "command": ["npm", "test", "--", "price"],
    "inputs": ["src", "test", "package.json", "package-lock.json"],
    "envKeys": ["NODE_ENV"],
    "resources": [],
    "timeoutMs": 600000
  }],
  "blocks": [{
    "id": "rounding",
    "goal": "Displayed totals respect the existing rounding rule",
    "scope": ["src/price.ts", "test/price.test.ts"],
    "criteria": ["rubric", "conformance", "rounding"],
    "checks": ["unit"]
  }]
}
```

Each check uses an argv array, not an implicitly evaluated shell string. If the approved command genuinely needs a pipeline, specify the actual shell and arguments explicitly. This is not permission to bypass a native sandbox denial. `inputs` are project-relative files, directory prefixes or globs; include config, dependency files and environment variables relevant to that command. `cwd` is a project-relative existing directory. Broad `.` inputs include ignored artifacts and can be costly or self-invalidating if a check writes build outputs; prefer actual source/config/dependency input directories. Exclude irrelevant documents only when they cannot affect that check.

For v5 truthful coordination, new approved specifications include `coordination`; `reviewFallback` remains optional:

```json
{
  "coordination": { "maxActiveAgents": 2 },
  "reviewFallback": {
    "model": "gpt-5.6-terra",
    "reasoningEffort": "high",
    "forkTurns": "none"
  }
}
```

`maxActiveAgents` is the concurrent child count. Choose it only after inspecting native capacity, current live children and their ownership. The runtime retains two as the policy default when this field is absent. `reviewFallback` is optional and must be an approved actual configuration; absent fallback does not authorize an implicit model substitution. Each approved roadmap child carries its own approved coordination fields before launch.

Inspect each actual script/config to determine setup dependencies. A local command does not need a service wrapper just because another check does. Attach required setup only to dependent checks and declare its wrapper in `inputs`. `envKeys` fingerprints inherited values; it does not inject configuration. `resources` names coordination locks, not services to start or permissions to grant. Use the current fields instead of inventing a shared setup DSL. This applies equally to new plans and authorized amendments; never infer requirements from project/provider/check names.

The default PATH fingerprint compares effective executable lookup, including tool names available to nested commands, instead of the raw directory string. Duplicate paths, directory aliases and reorderings selecting the same executables preserve evidence. A changed selected executable, permissions or relevant environment still invalidates it. Lookup is shared within each status/review operation, never cached across check completion. If the command inspects the literal PATH string or relies on invocation path spelling, declare `pathMode: "literal"`. Explicitly list a local check wrapper such as `.oso-code-codex/check-local.cjs` in `inputs`; exact internal helper paths are fingerprinted, while broad globs continue to exclude runtime records. Mutable runtime records under `runs`, `logs`, `reviews`, `locks`, or at `active`, `transaction.lock` and `memory-pending.json`, are rejected as explicit inputs to prevent self-invalidating checks.

Start once. Combine the specification above with the actual authorization in a single stdin object with keys `specification` and `authorization`, using `oso-codex start --file - --authorization -`. The authorization object has this shape:

```json
{
  "kind": "user",
  "reference": "actual-native-session/turn-or-message-reference",
  "message": "The user's actual instruction authorizing this scope",
  "specDigest": "the returned digest"
}
```

The CLI binds an omitted `specDigest` to that immutable specification; an explicitly mismatched digest is rejected. The actual authorization message and reference remain required. For separate transitions, `start --file -` accepts the plain specification, `authorize --file -` accepts the authorization, then `activate rounding` starts the block. Existing file arguments remain compatible. The CLI records evidence supplied by the principal; it cannot authenticate a human from arbitrary prose. Native Codex mode/approval and faithful agent behavior are the authority. Never fabricate the message or reference.

New approved AUTO specifications use `"recovery": { "mode": "auto" }`. Add a positive safe-integer `maxCorrections` only for an actual explicit total ceiling. New AUTO roadmap descendants share the root owner. Existing v1–v3 finite or absent policies remain readable and writable with their old semantics until `recovery adopt --file -` explicitly adopts AUTO. A preexisting finite child owner keeps its own policy until that owner adopts; root adoption cannot erase it. Existing finite grants use `recovery authorize`, while AUTO policy changes use `recovery adopt`. See [correction recovery](correction-recovery.md) for actual standing authority, payloads and replay semantics. Amendments cannot change or remove a recovery policy to reset history.

AUTO and explicit external fulfillment provenance require v4/minimum reader v4, with monotonic promotion. Truthful coordination, configuration and contribution accounting require v5/minimum reader v5. Only a new create, authorized amendment, or supported reconciliation may atomically promote a record to v5; reading or installing never migrates it. Older readers reject v5 records. A v1–v4 record remains governed by its compatible semantics until such a supported promotion, and rollback never downgrades any record. Preserve the run/Engram continuation and use a fresh compatible thread after updating the plugin.

For a roadmap child, the parent's approved specification contains the exact child specification. Use an approval object with `kind: roadmap`, `parentRun`, `parentDigest` and `child`. This is sufficient for that child; it is not another native human approval. A changed child needs a material amendment approved by the user.

Prefer `oso-codex child CHILD_ID` from the active parent (or `--run PARENT_ID`). It starts and activates the exact stored child with inherited authorization, or resumes its existing evidence and budget. No second spec file, copied digest or approval message is needed. Omitted child `principal` values inherit the parent's native identity when the original specification is loaded. The parent needs an integration block whose scope covers all child changes and whose criteria include rubric/conformance; required shared checks use the same check specification as children. Close each child, which restores the parent selection, then perform the parent's integration checkpoint and cumulative review. One capable cumulative report can cover both parent integration and final conformance when those scopes and criteria coincide; record both uses without another agent or suite execution.

Use the same check specification (id, argv, inputs and relevant options) for equivalent checks shared by the parent and children. The runtime reuses intact current evidence across that exact authorized roadmap family automatically. The original attempt and log remain in their owning run; no copying, shell rerun or manual green import is needed. A changed input still invalidates that evidence everywhere.

## Implement, check and review

The principal edits the approved scope. `oso-codex check --all` executes the block's required checks sequentially; a current successful result is reused. `oso-codex check unit` targets one. Exit 2 means an observed failed/blocked check; exit 1 means the runtime could not perform the requested transition. Read the returned log and cause, then repair that cause. Never rerun blindly.

For an intentional failing regression before implementation, use `check ID --red` on that block/check's first observation. Inspect the actual log to establish that the intended assertion failed. An observed nonzero product failure is recorded as `reproduced`, preserving its real exit and log without consuming an ordinary correction round; the CLI still exits 2 and no green evidence exists. A reproduction that unexpectedly passes records a delivery gap, requiring inspection of the reported behavior and coverage. Infrastructure failures still block normally. After implementation, run the ordinary check; never use `--red` to relabel a failed repair, warning or unexpected failure, or invent a historical failing test.

Delegate independent review through the actual native agent tool. Provide the criteria, relevant decisions, complete assigned base/scope, rubric path and current log records; ask for a full first pass and a batch of supported findings. Use [model selection and escalation](execution.md#model-selection-and-escalation) for the native launch. Immediately serialize its registration after the native tool starts it; a registration failure requires interrupting the child and reconciling partial effects before any baseline, evidence reuse or commit. Pass actual native prose through `--report -`; the runtime retains its own internal text evidence. Do not create a Markdown report file. No mandatory agent report schema exists. A v5 flow is:

```json
{ "id": "ACTUAL_NATIVE_ID", "role": "reviewer", "scope": ["src/price.ts", "test/price.test.ts"], "configuration": { "model": "gpt-5.6-luna", "reasoningEffort": "max", "forkTurns": "none" } }
```

Register that JSON with `oso-codex agent --file -`, then deliver and review it:

```sh
oso-codex review --agent ACTUAL_NATIVE_ID --report - --verdict pass --criteria rubric,conformance,rounding <<'OSO_REVIEW'
The actual independent reviewer report goes here unchanged.
OSO_REVIEW
oso-codex checkpoint
```

Prefer `review --agent ID --report - --verdict pass --all-criteria --finish` when the actual independent report covers every frozen criterion. `--all-criteria` records that explicit semantic attestation without retyping criterion labels; it never supplies missing review substance. `--finish` performs the same checked checkpoint and, for quick/debug/quality-pass, closes the run. For plan it checkpoints the slice; use `review --final ... --all-criteria --finish` for cumulative closure. Do not add a cumulative review to a quick/debug/quality-pass run.

`review` records a delivered reviewer automatically only for compatible legacy records. For concurrent v5 work, register a child immediately after its native launch with `agent --file -`. A requested configuration is nested under `configuration`; later host facts use `{ "actor": "ACTUAL_NATIVE_ID", "observation": { "model": "...", "reasoningEffort": "..." } }` with `observation --file -` after delivery. Record a finished applier with `{ "actor": "ACTUAL_NATIVE_ID", "scope": ["src/price.ts"], "evidence": "actual delivered result" }` through `contribution --file -`; principal contributions use the principal id explicitly. Record principal model provenance only through `observation --file`, never in a contribution payload. A replacement registration includes `"replaces": "COMPLETED_NATIVE_ID"`. Follow-ups retain original configuration and deliveries. Do not register fabricated identities or declare a possibly running writer finished. A duplicate identical delivered result is idempotent.

After checkpoint, commit only the owned reviewed change if the approved workflow calls for commits, then activate the next slice. Quick/debug/quality-pass close with `oso-codex close` after the combined review. In those modes, `--final` is an alias for the combined block review, retaining all block criteria; it cannot introduce a second review stage or skip the checkpoint. Plan/roadmap also need a cumulative independent review over the original change base; record it with `review ... --final --criteria rubric,conformance`. An existing suitable independent reviewer can do that assigned cumulative pass.

If a late fix is needed after a block checkpoint, `reopen --block ID` retains its findings and budget. Re-run affected checks and directed review, checkpoint again, then refresh the cumulative review. Do not create another run to avoid a failed block.

For selected A work already fulfilled by imported reviewed B checkpoints, record A's acceptance review without `--finish`, then use `checkpoint --file -` with the explicit mapping in [runtime recovery](runtime-recovery.md#record-explicit-external-fulfillment). Plain `checkpoint` keeps ordinary local closure semantics. Source provenance does not replace A's current required checks or independent review.

## Recovery, parked plans and memory

For an approved roadmap, `child CHILD_ID --run PARENT_ID` selects an exact approved child without another user approval. Optional child `dependsOn` lists preceding sibling IDs; a parked dependency remains incomplete. Reconcile and park the current child before selecting an independent sibling. Partial parked work requires isolation; selecting a child never discards that work or resets its rounds. Use the same child command to return to its retained block after the intervening sibling's reviewed commits.

For an actual failure, interruption, preserved-work adoption, or A → B → A transition, read [runtime recovery](runtime-recovery.md). Its sections cover same-checkout parking, isolated worktrees, exact contribution provenance and bounded permission/correction recovery. Do not load it on each ordinary check. Read `status` first; use `status --full` only when its complete inventory resolves a specific gap.

For a corrective pause, `recovery status` exposes effective policy, owner and readiness. Read [correction recovery](correction-recovery.md) for `recovery strategy --file -`, `recovery adopt --file -`, finite `recovery authorize --file -`, progress and legacy continuation. Under AUTO, stagnation calls for autonomous diagnosis and a changed strategy rather than another budget question. Actual explicit ceilings remain binding; zero remaining permits finishing the last authorized cycle, not starting another repair.

For undelivered Engram updates, use the versioned queue described in [shared memory](engram.md). `memory pending` reads the current position and pending metadata; `--full` includes the payload and superseded history only when reconciling an actual outage. No command writes to Engram or changes native compaction automatically.
