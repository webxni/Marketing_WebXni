# Agency Skills Research

Local WebXni skills are preferred because they encode production-specific approval gates, client workflow constraints, and the approved terminal harness. Do not auto-install untrusted community skills.

## Useful Official/Bundled Categories

- Code review: useful for System Reliability implementation work.
- Debugging and verification: useful for runner scripts and Worker checks.
- API usage: useful for structured JSON schema and provider integration.
- Security review: useful only for defensive review patterns.

## Community Skill Risk

Community skills may include broad shell assumptions, unsafe installation steps, or generic marketing advice that conflicts with WebXni’s approval and designer gates. Review manually before use.

## Recommendation

Recreate required behavior locally in `.claude/skills/webxni-*`. Install external skills only after code review, license review, and confirmation that they do not run arbitrary shell or bypass content gates.
