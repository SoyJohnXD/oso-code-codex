---
name: debt-sweep
description: Independently review touched code for the full OsoCode rubric and conformance to frozen decisions. Use for a requested debt audit or the cumulative final review of an OsoCode plan.
---

# Debt sweep

This is an independent review, with no product edits or recursive delegation. Read the [rubric](../../references/rubric.md) and [review guidance](../../references/review.md). Reviewer launches follow [model selection and escalation](../../references/execution.md#model-selection-and-escalation).

Acquire the full assigned change: the specified base-to-current range, pending tracked changes, and full untracked files. Use the base supplied by the principal. Do not silently substitute `HEAD` for the base of a multi-commit plan. Preserve unrelated files and the index.

Judge both axes: every applicable rubric rule and conformance to the bare frozen decisions and observable outcomes. Previously verified behavior is evidence; inspect its scope and current input identity before reusing it. Do not rerun the full suite merely to produce your own copy of its output.

Use the applicable [integration route](../../references/integrations.md), including actual Fallow analysis on JS/TS when available. Consume the existing current analysis when its scope covers the assignment. Preserve the full rubric; a tool summary alone is not the judgment.

Cover the complete assigned surface in the first pass and batch supported findings. For each, give the location, violated rule/decision, evidence and concrete readability or behavioral consequence. Check the surrounding code before asserting a violation. Cover cross-file duplication, dependency direction, existing primitives, logic placement, dead code and all four non-waivable classes. Confirm the resulting batch of fixes through directed follow-up on affected contracts, preserving unresolved findings.

Return the substantive verdict and coverage in ordinary prose. No exact final tag, echoed criterion spelling or `unknown_fields` line is required. Missing information should name the specific gap; inspect available local evidence and ask the principal for a focused follow-up when needed. The principal owns persistence and corrections.
