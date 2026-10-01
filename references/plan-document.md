# The approval document

Use this guide at the end of planning. The document must let the operator understand the result and another agent implement the accepted decisions without reconstructing the conversation. Write in the operator's language and established explanation depth.

## Repaso de cambios

Open with three explicit parts, usually within about twenty lines:

- **Qué se va a realizar:** explain the visible change one level above code.
- **Decisiones que lo moldean:** name the decisions that shape the result and why they matter.
- **Cómo va a funcionar:** explain how the pieces connect once the change is in use.

A list of files or implementation commands is not a substitute for this explanation. Keep the recap brief enough to orient the reader before the detail.

## Context and decisions

State the observed baseline, intended outcome and scope boundaries. Include the frozen ledger with reasons, rejected alternatives and actual user or delegated authority. Group related decisions; do not reproduce every question round or repeat the recap.

Carry these fields into the final document, even for a small plan; a list of decision labels does not preserve the ledger. Explain the applicable independent review and acceptance evidence in the same document so execution can start without reconstructing them.

Include a compact planning disposition: intent and map complete, ledger freeze and actual Doubt outcome, slices/waves/maximum width, execution mode and autonomy, including any forced choice and its reason. This reports completed planning work; it is not another confirmation.

Specify public contracts precisely where correctness depends on them. Put long contract inventories in a technical appendix within this same document when that improves readability. Do not replace decisions with links to private local files or an instruction for the implementer to decide later.

## Slices and waves

For every vertical slice, give its observable goal, expected files or modules, verification and dependencies, grouped in wave order. Verification includes a meaningful pre-change failing check where appropriate, or the reason for a different method. For visible work, name states, interactions and viewports, then the author and independent-reviewer current-observation evidence. Explain the maximum useful concurrency from actual dependencies, not the number of slices.

## Verification and continuity

Name the actual commands and behavioral acceptance criteria. Include cwd, relevant inputs/environment, setup and shared resources where those affect execution. Mark genuinely inapplicable checks with their reasons instead of inventing commands or services.

Describe applicable review, failure and pause/resume behavior. State compatibility, migration or recovery constraints only when the change has those surfaces. Preserve any limits on evidence or tooling; never present an unexecuted scenario as verified.

## Execution and delivery

Record autonomy, the treatment of new decisions, recovery policy, commit policy, authorized delivery actions and completion conditions. Approved AUTO uses `recovery: {"mode":"auto"}` without an invented numeric ceiling; carry any actual explicit correction, time or money limit. Explain the response to two corrections without qualifying progress: real diagnosis and a changed strategy within existing authority. If retaining a finite policy, state its binding limit and the ability to finish the last authorized cycle's verification at zero remaining. Preserve settled NORMAL/other-host boundaries and existing legacy authority; applicable standing authority can support explicit adoption on resume. External actions still depend on the actual recorded authority and native permissions.

Delegated work follows [model selection and escalation](execution.md#model-selection-and-escalation). Preserve the user's principal-model preference and describe only delegation choices the user actually made; the central policy governs child launch tiers and review floors. State the approved `coordination.maxActiveAgents` after checking native capacity, live children and ownership, and repeat it in each approved roadmap child. Include `reviewFallback` only as an actual approved model/effort configuration. The executable route records the absolute project, run id, literal Engram topic and actual approval reference; a reference is bound only upon approval or valid resume.

Use one complete `<proposed_plan>` document and the host's native approval. Its sections can be grouped for a small change; its substance must remain complete. Heading spelling, line counts and hidden markers are not gates. The Repaso adds no approval round. Preserve the full accepted document in the existing Engram plan topic at the next mode-permitted checkpoint; create no operational Markdown copy in the product repository.
