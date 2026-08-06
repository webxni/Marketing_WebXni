# Destination Mapping Repair

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
