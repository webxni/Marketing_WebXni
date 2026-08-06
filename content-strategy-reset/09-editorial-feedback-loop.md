# Editorial Feedback Loop

Every finding records finding type, severity, brand, content, source record type and ID, recommended source fix, review status, reviewer, and resolution time.

`blocker`, `high`, and `critical` findings block approval and publication. Medium and low findings remain pending until a human accepts or rejects them. The content hash binds a review to the exact version reviewed.

Approved source fixes must update or quarantine the referenced research, service, keyword, strategy, destination, or claim record. Approved editorial feedback is the only feedback loaded into future Gabriel prompts. Deleted drafts preserve material editorial failures as portfolio memory, so deletion cannot erase a repetition or policy signal.

Resolve findings individually through `POST /api/agency/content-reviews/:id/resolve` with `finding_index`, `review_status`, and `source_action`. The aggregate review remains pending while any finding is pending, and post approval rejects unresolved findings.
