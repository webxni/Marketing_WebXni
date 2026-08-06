# Destination Mapping Repair

## Live Audit: 2026-08-06

All four Upload-Post profiles are reachable. Each profile has nine healthy non-GBP destinations and one blocked Google Business destination.

| Brand | Canonical GBP ID | Live Name | Result |
|---|---|---|---|
| 24/7 Lockout | `locations/105295919997970852` | `24/7 Lockout Locksmith` | ID and name match; phone and market were absent from the provider response |
| 7/24 Locksmith | `locations/6092571096858603058` | `7/24 locksmith` | ID and name match; phone and market were absent; a second live location is present and remains unassigned |
| Daniel's Locks & Key | `locations/908727413318428834` | `Daniel's Lock & Key Service` | ID is live; canonical name differs; phone and market were absent |
| Unlock'D Pros | `locations/12106510679330317066`, `locations/3082714888579803430` | `Unlock´D Pros` on both | Both IDs are live, but their distinct address/service-area identities cannot be established; phone, address, and market were absent |

No GBP destination is marked healthy. Publishing remains held until provider data or owner evidence establishes the required business name, phone, and market identity.

## Daniel's Locks & Key

- Stored GBP account/location was stale.
- Canonical live account observed: `accounts_112906754238408611175`.
- Canonical live location observed: `locations/908727413318428834`.
- Migration updates the mapping but leaves verification pending until live business name, phone `(310) 600-2849`, and Hollywood/Los Angeles market all match.

## Unlock'D Pros

- Primary profile: `UnlockD_Pros`, location `locations/12106510679330317066`, internal label `Pasadena Primary`.
- Secondary profile: `UnlockD_Pros_2`, location `locations/3082714888579803430`, internal label `Pasadena Secondary`.
- Both remain blocked until each profile returns a distinct, matching business identity, phone `(818) 392-6390`, and authoritative address/service-area market.

## Checker contract

The checker accepts provider IDs from `location_id`, `id`, `name`, or `resource_name`; groups multi-location records by their Upload-Post profile; validates single and multi-location mappings; persists returned identity fields; and marks mappings changed by sync as unverified. A connected OAuth account alone is not healthy.
