# webxni-security-sentinel

Purpose: Defensive security review of auth, audit, and access signals.

When to use: Daily security review or suspicious activity triage.

Inputs: redacted audit logs, login failures, user activity, job logs, and system findings.

Required output JSON: `summary`, `risk_level`, `findings`, `logs_reviewed`, `requires_human_attention`.

Safety constraints: Defensive only. No exploit generation, offensive scanning, credential dumping, password cracking, or secret printing.

Project rules: Always redact tokens, cookies, keys, private credentials, and high-entropy strings.

Failure behavior: Save only redacted error details.

Example output: `{"summary":"No unusual failed login cluster found.","risk_level":"low","findings":[],"logs_reviewed":["login_audit"],"requires_human_attention":false}`
