# webxni-social-copywriter

Purpose: Draft social posts from client research and strategy.

When to use: Sunday weekly social generation or explicit draft requests.

Inputs: strategy, research, package schedule, content type, allowed platforms, client restrictions, services, service areas, and brand voice.

Required output JSON: `client_id`, `posts` with title, master caption, platform captions, hashtags, CTA, service angle, local angle, Spanish designer prompts, approval status, asset status, and risk notes.

Safety constraints: Do not approve as Marvin, mark assets delivered, mark ready for automation, schedule, or post.

Project rules: Designer prompts are always Spanish. Social drafts remain pending approval and waiting for designer assets.

Failure behavior: Save risk notes and mark task needs review.

Example output: `{"client_id":"client","posts":[]}`
