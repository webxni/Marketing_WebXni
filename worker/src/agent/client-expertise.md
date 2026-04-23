# Client expertise playbooks

Use these playbooks to frame captions, blog topics, and recurring-content strategies on a per-industry basis. Match on `clients.industry` (case-insensitive substring match against the headings below). When in doubt, call `get_client_details` and read the services + service areas before writing content.

---

## Locksmith / automotive / commercial locksmith
- **Dominant buyer jobs:** emergency lockout (urgency), rekey after move-in, upgrade to smart locks, key duplication, ignition repair.
- **Trust signals to surface:** licensed/bonded/insured, 24/7 availability, sub-30-min response time, mobile-service vehicle.
- **Local-SEO pattern:** `[service] in [city]` — always include a service area and a phone number.
- **Platform style**
  - Google Business: factual, local, 100-250 chars, direct CTA (CALL), include city + phone.
  - Facebook: mini-case-study or before/after, 200-350 chars, one emoji max.
  - Instagram: photo-first; caption opens with the hook ("Locked out at 2 am?").
  - LinkedIn: commercial focus — property managers, HOAs, office buildings, access-control integrators.
- **Blog angles**
  - "What to do if you're locked out of your [car|house|business] in [city]"
  - "Are smart locks secure? An honest take from a [city] locksmith"
  - "How much does [rekey | lock replacement] cost in [city] in 2026?"
- **Never** promise bypass of locks on vehicles/properties the customer doesn't own; never imply illicit entry.

---

## Builder / general contractor / remodeler
- **Dominant buyer jobs:** kitchen remodel, bathroom remodel, home addition, ADU, whole-home build.
- **Trust signals:** licensed GC, permits pulled, project-manager on site, workmanship warranty (5-10 years), real portfolio photos.
- **Visual direction:** before/after, progress shots, close-ups of finishes (cabinetry, tile, trim).
- **Platform style**
  - Instagram: strong portfolio imagery, `#beforeafter`, `#remodel`, local + style hashtags.
  - Pinterest: aspirational finished rooms, keyword-rich description, brand-board thinking.
  - LinkedIn: design-build expertise, commercial projects, team culture, subcontractor relationships.
  - Google Business: local neighborhood names, project-specific testimonials.
- **Blog angles**
  - "How long does a [kitchen|bathroom] remodel take in [city]?"
  - "Permits you need for a [project type] in [city/state]"
  - "Cost breakdown: remodeling a [room] in [city] in 2026"
- **Never** over-promise turnaround without caveats; always mention inspections/permits.

---

## Roofing / storm-damage / roof repair
- **Dominant buyer jobs:** roof replacement, storm damage repair, inspection, leak repair, new-construction roofing.
- **Trust signals:** factory certifications (GAF, Owens Corning), insurance-claim help, material + labor warranty, crew tenure.
- **Seasonality:** storm/wind/rainy-season content in Q1 + Q4; inspections in shoulder seasons; cool-roof / energy content in summer.
- **Platform style**
  - Google Business: hyperlocal storm damage / inspection CTAs.
  - Facebook: neighborhood-based project spotlights, drone photo.
  - Instagram: drone shots, close-up shingle detail, team photos.
  - Pinterest: style guides (architectural shingles, metal, tile).
- **Blog angles**
  - "5 warning signs your [city] roof needs replacement"
  - "Insurance claim help for storm-damaged roofs in [state]"
  - "Shingle vs. metal vs. tile: best roof for [city]'s climate"
- **Never** use cold insurance-claim-chasing language; stay educational.

---

## Marketing agency / AI / SaaS (WebXni self)
- **Buyer:** small-business owners, agency operators, in-house marketers.
- **Trust signals:** case studies with numbers, retention rate, platform certifications (Meta, Google), team photos.
- **Platform style**
  - LinkedIn: thought leadership, frameworks, contrarian takes, 300-600 chars.
  - X: one idea per post, punchy insight.
  - Instagram: behind-the-scenes, team, carousel frameworks.
  - Blog: long-form "how to" with real client-work examples.
- **Blog angles**
  - "How [specific workflow] saved [client type] [X] hours per week"
  - "The [X] tools we use to manage [Y] clients"
  - "Before you hire a marketing agency, ask these [X] questions"
- **Never** write generic "digital marketing is important" platitudes; always lead with a specific outcome.

---

## Default / unknown industry
- Always call `get_client_details` first.
- Tone: conversational-professional.
- CTA: `client.cta_text` if set, otherwise a neutral "Learn more" / "Get in touch" tied to the client's phone.
- Blog template: "[Service] in [service_area]: [how-to | cost | timeline | warning signs]".

---

## Cross-industry platform rules (apply after the industry playbook)
- **Instagram:** 150-300 char caption + 10-15 hashtags on new lines.
- **Facebook:** 200-400 chars, conversational, 1 emoji max.
- **LinkedIn:** 200-400 chars, insight-driven, ≤5 hashtags.
- **Google Business:** 100-250 chars, NO hashtags, always include city + phone.
- **Pinterest:** 150-200 char description + 5-8 hashtags, keyword-rich.
- **X / Threads:** ≤280 chars, one idea.
- **TikTok:** 150-250 chars, trending hashtags, hook in first line.

## How to apply
1. Call `get_client_details` and match `client.industry` to a heading above.
2. Pull 1-3 services from `services` array, 1-2 cities from `areas`, and the primary keyword from `intelligence`.
3. Cross-reference `buyer-personas.md` to pick a hook that matches the content intent.
4. Use the platform style block to format the caption.
