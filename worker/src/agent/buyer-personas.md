# Buyer personas

Use these archetypes to frame the hook, CTA, and pain point of every piece of content. Always ground the persona in the client's actual service menu and service areas (via `get_client_details`).

---

## The Emergency Caller
Applies to: locksmiths, roofing-leak repair, burst-pipe plumbers, 24/7 locksmiths.
- **State:** stressed, time-compressed, searching from a phone, can't wait.
- **Wants:** fast response, clear pricing, "are you open now?", reassurance.
- **Hook:** "Locked out at 2 am?" / "Water dripping from your ceiling?"
- **CTA:** `CALL` — include phone number prominently.
- **Avoid:** long explanations; save those for the blog.

## The Homeowner Planner
Applies to: remodelers, builders, roof replacement, solar, large-ticket HVAC.
- **State:** researching 3-6 months before purchase, comparing 2-3 contractors, risk-averse.
- **Wants:** portfolio proof, realistic timeline, permit + insurance clarity, references, warranty terms.
- **Hook:** "Thinking about remodeling your [kitchen]?" / "Planning a 2026 [project]?"
- **CTA:** book a free estimate / see our portfolio.
- **Avoid:** pressure tactics; build trust with specifics instead.

## The Commercial Property Manager
Applies to: multi-site locksmiths, commercial roofing, commercial builders, access control.
- **State:** juggling budget + owner/HOA reporting, needs a vendor they can trust with 10+ properties.
- **Wants:** reliability, multi-location coverage, invoiced billing, after-hours response, speed.
- **Hook:** "Multi-property portfolio? Here's what to ask your [service] provider."
- **CTA:** request a property-manager quote / ask about our commercial program.
- **Avoid:** consumer-retail framing; speak B2B.

## The Status-Driven Remodeler
Applies to: kitchen / bath remodelers, ADU, high-end builders.
- **State:** motivated by aesthetics + neighborhood resale value, likes finished-space imagery.
- **Wants:** high-end finishes, designer imagery, "this will add $X to resale."
- **Hook:** "The [kitchen island] trend adding real value in [city] in 2026."
- **CTA:** see the finished project / book a design consult.

## The Local Small-Business Buyer
Applies to: marketing agency clients (WebXni's own buyer), local-SEO services.
- **State:** wearing five hats, skeptical of agencies, has been burned before.
- **Wants:** specific ROI numbers, no long contracts, a real human they can call.
- **Hook:** "[Industry] owners: here's the one report we pull weekly."
- **CTA:** book a 15-min audit / see a real case study.
- **Avoid:** jargon, "digital transformation," vanity metrics.

---

## Picking a persona
1. Read the content intent (`educational` | `promo` | `cta`) if provided.
2. Read the client's industry and primary services from `get_client_details`.
3. Match to the persona whose "Applies to" line covers the client+service best.
4. If multiple match (e.g. locksmith doing both emergency + commercial work), default to the Emergency Caller for social/GBP and the Commercial Property Manager for LinkedIn.

## Writing framework (after you pick a persona)
1. Sentence 1 — name the specific pain (concrete: "at 2 am in the rain," not abstract: "when things go wrong").
2. Sentence 2 — offer ONE outcome they'll get from this client.
3. Sentence 3 — the approved CTA (`client.cta_text` or the persona default).

Keep it to three sentences for social. For blog intros, expand each sentence into a paragraph while keeping the same beats.
