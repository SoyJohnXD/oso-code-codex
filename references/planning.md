# Planning in Codex

Load this reference for planning, not every execution turn. Preserve established preferences, decisions and actual approvals. Native Codex mode is authoritative; a skill cannot change it by declaring a transition.

## 0. Resume and choose the route

Follow [shared Engram recall](engram.md) for this project's preferences, index and full ledger/plan, including plans authored by another host. Reconcile them with the project's local run and checkout. Report the recorded position and resume the first unresolved phase. Reconcile native agent handles and unfinished processes before replacement. Missing new-style phase labels in a historical plan are not missing substantive decisions.

| Recovered task | Route |
|---|---|
| New or unfinished planning | Native Plan mode, starting at the first unresolved phase |
| Complete plan without approval | Native Plan mode, present the full document without repeating resolved phases |
| Approved plan and an execution request | Read execution/runtime and resume directly; no new planning gate |
| Material change to approved scope or decisions | Native Plan mode, revisit affected phases and present a complete replacement |
| Fully specified approved roadmap child | Inherit the actual parent approval and execute; resolve only genuinely new material decisions |

Before phase 1, use the collaboration mode supplied by the host. If it is not Plan, explain once that the operator must activate Plan mode through the client (CLI: `/plan`) and name where planning will continue. End that turn without pretending the command executed. Do not parse transcripts, install an invocation-wide gate or substitute ordinary-chat questions for the requested native flow. Conversely, if approved execution is requested while the host remains in Plan mode, preserve the ready plan and identify the needed native transition to execution; do not replan it. Phases 1–5 do not edit the product or initialize execution state.

Consume explanation-depth and adaptive-teaching preferences silently. On the first plan without those preferences, ask them together once: concise/standard/didactic explanation and auto-detect/always/off teaching. Preserve explicitly unspecified preferences. The user's principal-model preference is consumed, not routinely questioned; native child launches use [the model selection and escalation policy](execution.md#model-selection-and-escalation). Persist semantic progress only when native mode permits those writes; otherwise retain it in the conversation/native plan for the next permitted Engram checkpoint.

## 1. Intent

Present two or three sentences of intent above the code level, explicit in/out of scope, and the visible outcome. Resolve ambiguity and obtain the user's intent confirmation before architecture decisions. Reuse an existing applicable confirmation; an approved execution request does not restart this phase.

Teach briefly when an unclear concept prevents a meaningful choice, following the teaching preference. If the request is small or specifically a bug, explain why quick/debug fits and honor the user's choice.

## 2. Surface mapping

Inspect actual modules, contracts, consumers, state and data flow. Start with a bounded inventory of entry points and likely surfaces, not whole files or a repository dump. Derive the surface map from evidence.

Delegate independent, read-heavy investigations to native explorers when the inventory reveals substantial separable surfaces, such as API consumers, database behavior and UI flows. Give each explorer a concrete question, bounded scope and the relevant decisions; request findings with source locations, consequences and remaining unknowns. Launch each under [the model selection and escalation policy](execution.md#model-selection-and-escalation). Keep a small or tightly coupled investigation local. Explain the choice briefly when it affects how the plan is being investigated; no delegation receipt or token threshold is required.

Use scoped context for each assignment. A finished explorer does not consume a permanent slot for a later independent judge.

Keep decisions and synthesis in the principal. Consume the returned evidence instead of repeating each explorer's search. Inspect a cited location only to resolve a specific uncertainty or integrate the findings. Limit command output to the facts needed for the next decision; list tool names before loading selected schemas, and search before loading long records. Compaction preserves continuity but does not make repeated reads free. After compaction, recover the ledger and current position rather than rebuilding the entire investigation.

Audit it against Contracts, Architecture, Errors, Verification and Reuse. Mark each lens covered or N/A with a reason. Derive further categories from the surfaces: data/migrations/source of truth, UX/accessibility/responsive/interaction states, security for auth/payments, rollback/cost/observability for infrastructure. A convention conflicting with a non-waivable rubric rule needs a real user decision; never quietly weaken the rule.

Build questions from that evidence and its consequences. Each surface has a question or reasoned N/A, and each core lens and derived category is covered. Present the map and dispositions before the first decision round, without a separate map-approval gate. Ask blocking decisions first; do not mechanically ask about every possible engineering topic.

## 3. Decision rounds and ledger

Use native `request_user_input` in Plan mode, at most three questions per call, with two or three concrete options, tradeoffs and the recommendation first. A question's necessary context belongs in its own fields. If the expected tool is unavailable, report the host limitation and retain pending questions rather than claiming they were answered. Verify unstable technical recommendations with local documentation or official sources; use Context7 when available. Reuse established facts instead of repeating lookups.

Cover the mapped categories. For each decision record its rationale, rejected alternatives, scoped outcome and user authority or explicit delegation.

The verification row names actual lint/type/test/build/runtime commands, input surfaces, zero-warning interpretation and behavioral acceptance criteria. For each command, inspect the actual script/config and record cwd, relevant source/test/config/dependency/environment inputs, required service/setup and shared resources. Use the existing CheckSpec fields; `envKeys` fingerprints relevant inherited variables and `resources` coordinates locks, neither provisions an environment nor grants access.

Use direct commands for independent checks. Attach setup wrappers only to checks that need that setup, and include each wrapper in its inputs. Do not give every check a database/browser/network dependency because one check needs it. Derive dependencies from evidence, never the project/provider or names such as unit/lint. Investigate uncertain dependencies or state the uncertainty; a label alone does not establish that a command is local. Record N/A only for an inapplicable check/criterion with a reason. Checks run sequentially by default; shared resources do not justify blanket elevation.

Record the change base or `none` for an unborn repository. Per-slice commits are the default unless the user's branch policy says otherwise. Preserve unrelated staged and unstaged work; commit only owned changes.

Offer and recommend an independent doubt pass when migrations, security or rollback surfaces produced derived decisions. On acceptance, pass only intent, map and bare decisions, and launch the reviewer under [the model selection and escalation policy](execution.md#model-selection-and-escalation). Reconcile findings against the ledger rationale; only material unresolved choices return to the user. Record an actual decline as a decline, never an invented absence of those surfaces. One pass ordinarily suffices, with directed follow-up only for changed decisions. Stop repeated clean reviews. Preserve the full frozen ledger in Engram at the next mode-permitted checkpoint using [shared memory](engram.md).

An accepted Doubt pass requires an actual independent agent result. The principal's own critique cannot be recorded as that pass. Reuse a suitable finished agent when independence is preserved; an unavailable reviewer remains a specific unmet criterion, not a reason to repeat exploration.

After completing the verification row, change base and applicable doubt outcome below, present the question battery reconciled to decisions, delegated choices or reasoned N/As. Name any open assumption and its consequence. Then ask for ledger-freeze confirmation with native `request_user_input`, offering acceptance or revision, and wait for the answer before slicing. The answer must resolve or explicitly delegate open assumptions. Answers to individual technical questions do not themselves confirm the reconciled ledger. Reuse an already frozen applicable ledger without this question. This confirmation settles decisions, not permission to implement.

## 4. Slicing and autonomy

Cut vertical slices delivering observable progress. Each has a goal, expected files/scope, criteria, verification and dependencies. A meaningful failing check belongs where behavior can be tested; a docs/config change may use a justified alternative. Do not manufacture a red test after implementation.

Derive dependencies from contracts, shared writes, data flow, verification coupling and file conflicts. Offer expand/migrate/contract when evolving widely consumed contracts; prove no old consumers remain before removing the old contract. Cut slices for observable progress, then derive their graph and waves, never the reverse. Present each slice's goal, files, verify and depends-on in wave order, with the widest width.

For a UI surface, read existing product/design conventions and acceptance criteria. State required states, interactions and viewports in the plan. If foundations are missing, inspect the installed Impeccable guidance and plan the appropriate foundation work before dependent UI slices, scoped to the actual artifact it creates. Follow [integrations](integrations.md) for the author and independent-reviewer observation contract; absence preserves the exact pending visual criterion rather than erasing design checks.

Resolve execution mode and disposition in one native question round unless already recorded. Offer sequential versus independent worktrees only when both are feasible, showing width, integration cost and recommendation; recommend sequential at width two. Base `none`, disabled per-slice commits, or no independent work forces sequential: record the reason instead of asking a meaningless choice. Inspect native total capacity, live children and ownership, then record the approved `coordination.maxActiveAgents` for the plan and every approved roadmap child. It counts children; without it legacy policy remains two. Include an approved complete `reviewFallback` only when a fallback model/effort is actually chosen. Do not add either field after approval merely to improve accounting.

Resolve NORMAL versus AUTO autonomy in that same round: NORMAL returns genuinely new material choices to the operator; AUTO continues within the explicitly delegated policy and preserves a precise blocked item when that policy cannot decide. Routine reversible choices within approved scope remain authorized; the principal retains decisions, integration and closure. State limits on scope/contracts/cost/irreversible actions and separate native permissions/publication. An autonomy choice does not authorize new external actions. Include sufficiently specified roadmap children and dependencies so one approval can authorize execution. Do not ask again for established mode/disposition or delegated choices.

For approved AUTO execution, specify `recovery: {"mode":"auto"}` and progress-based recovery. Do not invent a finite allowance from the slice count or uncertainty. Include `maxCorrections` only when the user actually sets a limit, and preserve other scope, time, cost and native-permission boundaries. Explain that two corrections without qualifying progress require autonomous real diagnosis and a changed strategy; all verification and review criteria remain binding. New AUTO roadmap descendants share the root owner; separately approved independent plans have their own authority.

An existing plan, NORMAL disposition or other-host policy is not silently rewritten. On authorized resume, inspect applicable standing authority and follow [correction recovery](correction-recovery.md) for explicit AUTO adoption; reuse authority that already covers it without reopening completed planning or asking again. Preserve newer explicit limits and preexisting durable finite child owners until each actually adopts. A retained finite policy supports explicit finite grants, and its final authorized correction may finish verification at zero remaining.

## 5. Repaso and native approval

Read [the approval document guide](plan-document.md) when composing the final plan. Keep the original three-part Repaso first, followed by decision-complete detail in the chosen hybrid structure. Preserve the actual decisions and verification contracts; summarize repeated discussion rather than deleting information an implementer needs.

Present that complete document in one `<proposed_plan>` block through the native planning/approval interface. Wait for actual user authorization; the Repaso needs no separate confirmation round. Feedback produces a complete replacement, not only a delta. A material change after approval revisits affected decisions and requires authorization of the complete updated plan. An already approved roadmap child references its real authority instead of fabricating another one.

Persist the complete accepted plan and ledger in their existing Engram topics and merge the index using [shared memory](engram.md), when native mode permits. No auxiliary Markdown copy belongs in the product repository. After approval and a native mode permitting execution, read [execution](execution.md). Record the executable specification and actual approval message/reference through the runtime's stdin interface. The route binds the absolute project, run id, literal Engram topic and actual approval reference; planning never fabricates a future reference. A memory failure follows the bounded outage route; it does not invent authorization or erase local progress.
