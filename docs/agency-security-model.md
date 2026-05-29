# AI Agency Security Model

## Whitelisted Execution

Agency jobs use `approved_command_jobs.command_name`. The local Discord bot maps each allowed command name to a fixed script path. User-provided shell commands are never accepted.

## Secret Redaction

Worker APIs and agency scripts redact bearer tokens, API keys, private keys, cookies, passwords, Discord tokens, Cloudflare tokens, OpenAI keys, Anthropic keys, Gemini-like high-entropy strings, and authorization headers.

Redacted value:

```text
[REDACTED_SECRET]
```

## Internal Protection

Agency runner updates use `/internal/agency/*` with the same Discord bot bearer secret pattern used by existing approved job endpoints.

## Human Gates

Agents cannot mark content approved, delivered, ready, scheduled, posted, or published. Existing post and blog gates remain the source of truth.

## Defensive Security Agent

Security Sentinel is defensive only. It can summarize suspicious events and create findings, but cannot scan external systems, exploit vulnerabilities, crack passwords, or print credentials.
