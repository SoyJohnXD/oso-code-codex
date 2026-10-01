---
name: roadmap
description: Define and execute a sequence of OsoCode changes under one explicit Codex roadmap approval, including child scopes, dependencies and autonomy limits. Use when the user wants multiple planned changes to run unattended.
---

# Roadmap

Read [shared Engram memory](../../references/engram.md) to recover the roadmap, preferences and child position before choosing a route. An approved roadmap with an execution request resumes directly; an exact approved child does not enter planning again.

For new or unfinished planning and material revisions, follow [planning](../../references/planning.md) in native Plan mode, including its phase decisions. Define the objective, observable outcomes, children, dependency order, verification bar and autonomy limits together. Ask unresolved material product/architecture decisions once. Include the sufficiently specified children in the Repaso-first approval document. Wait for actual approval before execution.

Record approved `coordination.maxActiveAgents` in the roadmap and every child after checking native capacity, live children and ownership. Optional `reviewFallback` names an approved actual model and effort. Do not inject either into an old approved child retrospectively.

One actual user approval authorizes the listed children within their scopes. After approval and an execution request, when native mode permits execution, read [execution](../../references/execution.md) and [runtime](../../references/runtime.md). Before product edits, start or resume the authorized parent/child runtime; reconstruct it only when its record is unavailable, from the absolute project, run id, literal Engram topic and actual approval reference. Preserve missing indispensable authority or identity as pending. Child model selection, delegation and review use [execution's central policy](../../references/execution.md#model-selection-and-escalation). If native mode is still Plan, preserve the ready roadmap and identify the needed client transition without replanning. Store each child specification in the parent's `children` array. A child authorization has `kind: roadmap`, the real parent id and digest, and the child id. It is derived authorization, never a fictional user message.

An approved AUTO roadmap uses `recovery: {"mode":"auto"}` at its root without an arbitrary ceiling; new descendants share that owner. Preserve actual explicit limits and preexisting durable finite child owners until each is explicitly adopted under applicable authority. For adoption or a correction pause, load [correction recovery](../../references/correction-recovery.md). Existing standing authority can cover adoption without another question. Moving between children or parking one preserves corrections and evidence; stagnation calls for autonomous diagnosis and a changed strategy.

Resolve choices in this order: the child's frozen decisions, the approved global roadmap policy, current documented project practice, then the simplest option within explicitly delegated AUTO authority. A lower level cannot override a frozen decision, native permission or external-action boundary. A child with only an intent and unresolved material planning remains pending for native Plan mode; prepare complete child plans up front for unattended execution.

Execute sequentially by default with `oso-codex child CHILD_ID --run PARENT_ID`. Record sibling dependencies in each child's `dependsOn` list; only completed dependencies permit execution. A child requiring a material scope, contract, cost, irreversible action or permission change retains that precise blocker. Park it after reconciling native handles, preserve its position, and continue only a ready independent child. Use [runtime recovery](../../references/runtime-recovery.md) for clean handoffs or isolated work when partial changes exist. Reopening, parking or relabeling a child does not reset its budget. Return through its existing identity and reviewed contribution provenance.

Use `oso-codex roadmap reconcile --run PARENT --child CHILD` only for its unique supported legacy lineage. It promotes a complete additive ordered-prefix history with real authorization; a replacement that drops or changes an original dependency does not satisfy it. Independent ready siblings remain valid. Read/install never migrates a child, and the command never fabricates past approval.

Do not re-enter a human approval gate for a routine implementation choice covered by the roadmap. Do not silently replace a frozen decision. The principal resolves a code divergence or a clear merge conflict; a decision change returns to the user.

Close only after every child and the cumulative debt/conformance review meet the approved bar. Publication is a separate explicit scope; unattended execution alone does not authorize production, push or PR publication.

Update the existing Engram parent ledger/index and child plan topics as the queue advances. Preserve other rows, dated decisions and explicit pendings. Another host resumes those same records; no per-child Markdown handoffs are needed.
