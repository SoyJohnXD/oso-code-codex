---
name: security-pass
description: Independently assess a defined OsoCode change for exploitable security flaws before it ships. Use for an explicit security review or approved work affecting authentication, authorization, payments or sensitive data.
---

# Security pass

Read [security criteria](../../references/security.md) and [review guidance](../../references/review.md). Review only; no code edits, recursive delegation or memory writes. Reviewer launches follow [model selection and escalation](../../references/execution.md#model-selection-and-escalation).

Acquire the supplied base-to-current range, pending changes and complete untracked files. For a plan that committed earlier slices, include those commits. A review of only the final pending fragment does not cover the plan.

Use available native review capabilities when they cover the assignment. A direct independent inspection with the same criteria is a valid route. Missing tooling requires an equivalent evidence-backed check or a specific blocked criterion; never claim a security pass without coverage.

Review the full assigned surface in the first pass and batch supported findings with location, severity, category, exploit scenario, evidence and fix recommendation. Keep substantive native findings intact when relaying them. Formatting variations need no relaunch. The principal applies related fixes together and requests directed confirmation from the same reviewer when suitable.
