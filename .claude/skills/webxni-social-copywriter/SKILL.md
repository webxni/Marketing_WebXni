# webxni-social-copywriter

Purpose: Draft social posts from client research and strategy.

When to use: Sunday weekly social generation or explicit draft requests.

Inputs: strategy, research, package schedule, content type, allowed platforms, client restrictions, services, service areas, and brand voice.

Required output JSON: `client_id`, `posts` with title, master caption, platform captions, hashtags, CTA, service angle, local angle, Spanish designer prompts, approval status, asset status, and risk notes.

Safety constraints: Do not approve as Marvin, mark assets delivered, mark ready for automation, schedule, or post.

Project rules: Designer prompts are always Spanish. Social drafts remain pending approval and waiting for designer assets.

Quality bar: Every post must include a real service, real locality, distinct hook, platform-specific caption, practical CTA, and Spanish production-ready designer prompt. Avoid filler such as "trusted team", "top-notch", "look no further", "exceptional service", "tailored solutions", or copy that could fit any competitor. review_notes must list the service, locality, CTA reason, and assumptions.

Failure behavior: Save risk notes and mark task needs review.

Example output: `{"client_id":"client","posts":[]}`
