# Preserve criteria when integrations vary

An absent integration is not a failed application, and it is not a completed check. Identify the intended criterion and use an equivalent source of evidence when possible. Record the actual route and remaining limits. Block only a criterion that lacks a sufficient alternative.

| Integration | Preserved purpose | Equivalent route |
|---|---|---|
| Engram | Shared plans, decisions and cross-host continuity | Follow [the Engram protocol](engram.md) as the normal memory path. On outage, preserve pending delivery in the ignored recovery queue, continue only unambiguous authorized work and report the unsynchronized handoff. Local evidence does not substitute for a claimed shared-memory write. |
| Context7 | Accurate version-relevant technical guidance | Installed code/local docs or official documentation for the actual dependency version. Cache established facts within the task. |
| Fallow | Dead code, duplication, architectural debt | Existing repository lint/type/dependency tools plus a scoped search and independent whole-change inspection against every applicable rubric rule. Inspect cross-file patterns, not just changed lines. |
| Impeccable | Product/design quality | Read product/design conventions, inspect the actual UI and visual output, and review applicable accessibility, responsiveness, hierarchy, interaction states and copy. Use browser/screenshot evidence where the visible result matters. |

A Fallow alternative is sufficient only when all relevant debt dimensions are actually covered. Typecheck alone does not establish absence of duplication or architectural debt. The independent report cites the analysis and evidence used.

## Select the actual route

For JS/TS debt or quality review, discover the installed Fallow capabilities once and use `find_dupes` and `audit` against the actual project and assigned change base. Inspect duplication, dead-code and complexity results, including cross-file patterns and tool exclusions. Select bounded output and retain the relevant evidence for the independent reviewer; do not rerun identical analysis merely to give each agent its own output. Findings outside the assigned change are context, not automatic scope expansion. These tools supplement the full rubric and conformance judgment.

If those results cover the applicable dimensions, proceed to dispositions and review. Add broader `analyze` or `check_health` calls only for a named gap that the existing results cannot answer. Prefer result summaries and relevant findings over complete dependency graphs or repeated health reports; preserve exclusions and diagnostic limitations in that summary. Repeat affected analysis after a real code change, not after each metadata update.

Use `get_cleanup_candidates` only with a real runtime coverage input accepted by the installed API. The current route requires that input; do not invent coverage, treat unobserved code as unused, or require paid continuous capture for ordinary cleanup. If coverage is absent, use the static audit and inspect callers and entry points. Identify any criterion that still lacks evidence. Tool availability and successful invocation are different facts; report the latter only from an actual result.

Use Context7 for unresolved dependency/API questions after establishing the version in local code and documentation. If unavailable, consult version-relevant official documentation. Reuse an established answer within the task; no ceremonial lookup is needed for a known local primitive.

When the approved change affects visible product UI, use the available Impeccable skill and inspect the actual result against product conventions. The plan names required states, interactions and viewports. The principal sets up the app and data once; the author records a current post-change observation, then an independent reviewer records a current render and critical interactions. Ordinary evidence identifies build/code, URL, viewport, data, observer and artifacts. Previous screenshots and author reports do not satisfy independent observation. If no reliable current capability exists, retain the exact visual criterion as pending. Backend-only changes do not trigger a design ceremony or a visual schema. Explicit security requests and changes to authentication, authorization, payments or sensitive data use the dedicated security criteria and an independent capable reviewer. The same reviewer may cover general and security criteria when competent and explicitly assigned both; keep the evidence for each dimension.

For a UI change, preserve the product's design criteria and the original design audit's severity policy: no P0/P1 finding remains; any allowable P2/P3 residual is explicitly named and governed by the approved design criteria. This does not waive a real rubric violation, warning, missing behavior or inaccessible required state. A missing visual tool may require a blocked visual criterion when no reliable substitute can inspect the result.

Security uses [security criteria](security.md) and independent review. An absent native specialist is replaced only by an independent reviewer capable of the same criteria. A principal's self-attestation does not replace an independent judgment.

Do not reinstall or pin unrelated integrations as a prerequisite to every task. Inspect an installed capability once; if it cannot run, classify the cause, select a sufficient authorized alternative or retain the precise blocker. Native permission denials still require the native approval route.
