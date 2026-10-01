---
name: triage
description: Classify an OsoCode execution failure using its actual command output, relevant diff and environment evidence. Use when a failure's cause is unclear; this is a focused diagnosis, not a mandatory additional agent stage.
---

# Triage

Inspect the actual failed command or native delivery, its cwd, inputs, output and relevant change. The principal can do this directly. If an independent investigation is useful, assign just the unanswered causal question under [model selection and escalation](../../references/execution.md#model-selection-and-escalation) and forbid recursive delegation.

Classify as product defect, infrastructure/permission failure, delivery/evidence gap, or material decision. Run the smallest useful probe to distinguish plausible causes. Compare a baseline only when it resolves a real attribution question; do not create another checkout by default.

Name the evidence supporting the classification and the next action. Preserve a real product failure even when infrastructure also failed. A notice, update banner or different report label does not alone imply a product defect.

Use the existing block and recovery budget. Reconcile native handles and owned processes before replacement. The same unchanged blocked cause must not trigger another full verification or another agent.

When this diagnosis supports a stagnation recovery, provide its actual evidence and a changed strategy for [correction recovery](../../references/correction-recovery.md). Under AUTO, two corrections without qualifying progress require this autonomous work, not another budget question. Preserve explicit limits and native boundaries. The principal can record the strategy directly; an extra triage agent is not mandatory, and diagnosis itself is not progress.
