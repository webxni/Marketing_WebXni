# Generation Gate Specification

Generation validates the full four-brand portfolio before planning or resuming a run:

- approved brand profile
- approved strategy covering the requested date
- one approved monthly plan with exactly 26 approved slots
- all active services and service areas approved
- 20-35 active approved keywords
- every active destination identity verified
- no pending research; only approved matching unexpired research is loaded
- every slot claim requirement has an approved evidence record
- no cross-brand planned-topic collision

Failure returns `Generation blocked:` plus concrete reasons. Governed brands never fall back to API topic research, unapproved data, rotation, or ad hoc topic invention. Save-time semantic, quality, and portfolio duplicate checks remain mandatory even after planning succeeds.
