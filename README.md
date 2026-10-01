# OsoCode for Codex

OsoCode's planning and code-quality discipline, implemented specifically for Codex. The principal can build, repair and integrate; independent reviewers judge the actual change. The runtime retains executed evidence and recovery guided by actual progress and approved authority, without mandatory handoff receipts or repeated clean verification.

This is a Codex-only derivative of [OsoCode](https://github.com/SoyJohnXD/oso-code), licensed under Apache-2.0. The original project's history is available there. Claude Code and OpenCode are outside this package's installation and execution surface.

## Use

After installation, open a **new Codex thread** and invoke a workflow explicitly:

- `$oso-code-codex:plan`: discover, decide and approve a substantial change, then execute reviewed slices.
- `$oso-code-codex:roadmap`: approve sufficiently specified children together and execute them under that approval.
- `$oso-code-codex:quick`: a small authorized change with one combined independent review.
- `$oso-code-codex:debug`: reproduce, diagnose and fix a bug with regression evidence and one independent review.
- `$oso-code-codex:quality-pass`: improve a defined surface against the complete rubric.
- `debt-sweep`, `doubt-pass`, `security-pass` and `triage` supply scoped specialist guidance when needed.

An approved plan's execution continues with ordinary language such as “Implementa el plan aprobado”. Engram is the normal shared store for preferences, full decisions, plans, diagnoses, progress and summaries, using the same `oso/index` and `oso/{change}/...` topics as the other hosts. Before editing, every workflow starts or resumes its authorized runtime, reconstructing only an unavailable record from the absolute project, run id, literal Engram topic and actual approval reference; planning binds the final reference only when approval or valid resume supplies it. The principal recalls existing records, merges updates and preserves unrelated rows and history. See the [shared memory protocol](references/engram.md).

To continue another host's work, invoke `$oso-code-codex:plan` and ask: “Continúa el plan de [cambio] guardado en Engram para [proyecto], conserva sus decisiones y ejecuta lo pendiente”. Codex reads the full plan, reconciles the current checkout and existing authorization, and updates the same memory topics. It does not import another host's old green flags or live agent handles.

No operational Markdown plan, ledger or reviewer-report files are needed in the product repository. Runtime inputs and native reviewer prose can arrive through stdin. The single ignored `.oso-code-codex/` directory retains technical run JSON, logs, internal text evidence, native handles, policy and correction history. A memory outage uses one pending-delivery JSON queue there; the agent reports unsynchronized handoff instead of looping or claiming a successful save. Resume an existing run rather than replacing its authority.

You can park an approved plan, execute a separately approved change and return to the original block. A clean checkout can be reused; partial work stays in its checkout while the new change uses an isolated worktree. Return validates reviewed commits, file contents and modes, and retains the original approval, findings and correction history. If imported B checkpoints fulfill A's selected block, `checkpoint --file -` records an explicit mapping after A's own current checks and independent acceptance; it does not infer completion from names or copy B's green result. Roadmap children inherit the exact parent approval and respect declared dependencies. See [parking, external fulfillment and recovery](references/runtime-recovery.md).

Codex keeps its native compaction. There is no additional session-start or compact hook. Scoped exploration, bounded tool results and Engram recall for missing facts supplement native continuation. Context7 remains available for uncertain API behavior after checking the installed version and local documentation.

## What controls quality

The [rubric](references/rubric.md) is byte-for-byte the upstream rubric. Its hard blockers and non-waivable debt rules remain. A block closes only with valid executed checks, current independent review covering its criteria, no unresolved findings, reconciled agents and in-scope changes. Plan and roadmap also require cumulative independent debt/conformance review. New approved work records child coordination, requested configuration and contributions truthfully; native capacity governs the approved child limit, while legacy records retain their compatible policy until a supported v5 promotion.

Checks run through one executor. Unchanged relevant inputs and intact logs permit reuse; changed source, config, tests, dependency inputs or declared environment variables invalidate affected evidence. Real warnings remain failures. A notice or update banner is not classified as a warning merely because it exists.

New approved AUTO work uses `recovery: {"mode":"auto"}` without an arbitrary correction ceiling. An actual explicit `maxCorrections` remains binding. Two corrections without qualifying relevant progress require autonomous diagnosis and a changed strategy; repeated green checks, oscillation and rewording do not manufacture progress. Existing v1–v3 finite or absent policies remain writable until explicit adoption. Applicable standing authority can authorize `recovery adopt --file -` on resume without another user question; newer limits and native boundaries still apply. Finite grants remain available for retained finite policies. See [correction recovery](references/correction-recovery.md).

Appliers receive bounded decisions, invariants, ownership, environment, affected checks and a done condition. Independent reviewers cover the full assigned surface in their first pass and batch findings; related fixes receive directed confirmation from the same reviewer. Checks use only their actual setup dependencies and reuse only current intact evidence. Every criterion must pass before closure.

The [execution contract](references/execution.md), [CLI reference](references/runtime.md) and [installation guide](docs/installation.md) explain the package.

## Install or update locally

Requirements: Node >=22.18, Python >=3.11, Git and a Codex version supporting local plugins, skills, native subagents and hooks. Use your existing Codex authentication and principal model. This installer does not install or repin Engram, Context7, Fallow or Impeccable.

On a new computer, clone this repository and install the checked version:

```sh
git clone https://github.com/SoyJohnXD/oso-code-codex.git
cd oso-code-codex
npm ci
npm run validate
python3 scripts/install.py install
python3 scripts/codex-probe.py --project "$PWD" --trust-owned --output /tmp/oso-code-codex-load.json
```

The last command uses Codex's native configuration API to enable and trust only this plugin's current hook hash. Native permissions still apply. Open a fresh thread after an update, carrying the existing run/Engram position and actual authority: existing conversations may retain removed cache paths or older instructions. Installation never migrates project records. AUTO and external fulfillment provenance require v4/minimum reader v4; truthful coordination and contribution accounting require v5/minimum reader v5. Promotions are monotonic and older payloads cannot downgrade them. The installer records ownership and refuses to overwrite user-modified or unowned files. See [installation and rollback](docs/installation.md), including the official cachebuster step before updating an existing plugin.

No global main model, base instructions, compaction, sandbox policy, or unrelated integration is replaced. Source development follows [model selection and escalation](references/execution.md#model-selection-and-escalation); custom roles remain unpinned.

## Develop

```sh
npm run typecheck
npm test
npm run build
npm run check
```

`src/` is the sole runtime source. `scripts/build.mjs` registers the single generated runtime output `dist/oso-codex.cjs`; `npm run check` proves exact regeneration. Builder annotations in that registered output are evaluated under the existing rubric's generated-output rule. Source-authored inline comments receive no exemption.

The native fixtures exercise agent behavior in addition to deterministic runtime tests. Their observations and limits are recorded rather than represented as a guarantee of bug-free software or a universal token saving.

The deterministic test suite covers the runtime and installer. Native agent behavior also depends on the installed Codex version and its enabled capabilities.
