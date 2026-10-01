# Security criteria

Preserved from OsoCode's security-pass criteria. Acquire the complete assigned change and its context. Report demonstrable exploitable issues with high confidence (the original threshold is >80%); minimize unsupported findings.

Categories:

- Input validation: SQL/command injection, traversal, XXE, template injection.
- Authentication/authorization: bypass, privilege escalation, session/JWT flaws.
- Cryptography/secrets: hardcoded keys, weak cryptography.
- Code execution/injection: unsafe deserialization, eval, XSS.
- Data exposure: sensitive logging, PII leakage.

The original dedicated security-pass scope excludes denial-of-service, secrets-on-disk, rate limiting and resource exhaustion. These exclusions do not waive the main rubric's hardcoded-secret rule or explicit product/security criteria in the approved plan.

For each finding: location, HIGH/MEDIUM/LOW severity, category, exploit scenario, evidence, consequence and fix recommendation. A missing tool or incomplete range produces a specific coverage gap, not a clean verdict. The same independent reviewer may confirm directed fixes with current evidence.
