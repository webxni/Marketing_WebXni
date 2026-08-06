import { describe, expect, it } from 'vitest';
import { destinationIdentityMatches, normalizeGbpDestination } from './gbp-destination';

describe('GBP destination normalization', () => {
  it.each([
    [{ location_id: 'locations/1' }, 'locations/1'],
    [{ id: 'locations/2' }, 'locations/2'],
    [{ name: 'locations/3' }, 'locations/3'],
    [{ resource_name: 'locations/4' }, 'locations/4'],
  ])('supports provider ID shape %#', (payload, expected) => {
    expect(normalizeGbpDestination(payload).id).toBe(expected);
  });

  it('extracts and verifies business name, phone, and market', () => {
    const destination = normalizeGbpDestination({
      name: 'locations/908727413318428834',
      title: "Daniel's Locks & Key",
      phoneNumbers: { primaryPhone: '+1 310-600-2849' },
      storefrontAddress: {
        addressLines: ['123 Test Street'],
        locality: 'Hollywood',
        administrativeArea: 'CA',
        postalCode: '90028',
      },
    });

    expect(destinationIdentityMatches(destination, {
      businessName: "Daniel's Locks & Key",
      phone: '(310) 600-2849',
      market: 'Hollywood',
    })).toEqual({ ok: true, nameMatch: true, phoneMatch: true, marketMatch: true });
  });
});
