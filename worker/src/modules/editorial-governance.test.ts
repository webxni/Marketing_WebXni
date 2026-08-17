import { describe, expect, it } from 'vitest';
import type { ClientRow } from '../types';
import {
  findProhibitedLocksmithService,
  getLocksmithPortfolioTopicCollision,
  locksmithProfileRequiresReapproval,
  validateLocksmithGeneratedContent,
} from './editorial-governance';

function mockDb(claims: string[] = [], areas: string[] = ['Pasadena']): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('client_approved_claims')) {
                return { results: claims.map((claim_text) => ({ claim_text })) };
              }
              if (sql.includes('client_service_areas')) {
                return { results: areas.map((city) => ({ city, state: 'CA' })) };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const client = {
  id: 'client-1',
  slug: '247-lockout-pasadena',
  owner_group: 'gabriel-locksmiths',
  canonical_name: '24/7 Lockout',
  phone: '(323) 346-7344',
} as ClientRow;

describe('locksmith editorial governance', () => {
  it('reopens approval after a material governed profile change', () => {
    expect(locksmithProfileRequiresReapproval(client, { notes: 'New approved-profile candidate' })).toBe(true);
    expect(locksmithProfileRequiresReapproval(client, { package: 'medium' })).toBe(false);
    expect(locksmithProfileRequiresReapproval({ ...client, owner_group: null, slug: 'other' }, { notes: 'Changed' })).toBe(false);
  });

  it.each([
    'duplicate keys for a building',
    'coded-key copying',
    'remote-key reprogramming',
    'new key fob creation',
    'transponder chip key service',
    'ignition repair',
  ])('detects semantic prohibited service: %s', (value) => {
    expect(findProhibitedLocksmithService(value)).not.toBeNull();
  });

  it('does not treat an unrelated approved neutral claim as arrival-time evidence', async () => {
    const issues = await validateLocksmithGeneratedContent(mockDb([
      'Call to confirm current availability service coverage and scheduling',
    ]), client, {
      title: 'Pasadena house lockout guidance',
      master_caption: 'We guarantee arrival in 20 minutes. Call to confirm current availability service coverage and scheduling.',
    });

    expect(issues).toContain('unapproved claim: exact arrival-time claim');
  });

  it('blocks sibling-brand, unapproved-location, and phone contamination', async () => {
    const issues = await validateLocksmithGeneratedContent(mockDb(), client, {
      title: "Unlock'D Pros in Burbank",
      master_caption: 'Call (818) 555-0199 for residential lock repair.',
    });

    expect(issues).toContain("wrong brand: Unlock'D Pros");
    expect(issues).toContain('wrong or unapproved location: Burbank');
    expect(issues).toContain('invalid or mismatched phone');
  });

  it('does not block Hollywood when it only appears inside approved North Hollywood', async () => {
    const issues = await validateLocksmithGeneratedContent(mockDb([], ['North Hollywood']), {
      ...client,
      slug: '724-locksmith-ca',
      canonical_name: '7/24 Locksmith',
    } as ClientRow, {
      title: 'Locked Out In North Hollywood? Three Steps Before You Panic',
      master_caption: 'A lockout is stressful. 7/24 Locksmith helps North Hollywood drivers, renters, homeowners, and businesses with practical lockout guidance.',
      cap_facebook: 'Locked out in North Hollywood? Stay safe, confirm the exact address, and avoid forcing the lock.',
      cap_instagram: 'North Hollywood lockout checklist: stay safe, confirm the exact address, and avoid DIY lock damage.',
    });

    expect(issues).not.toContain('wrong or unapproved location: Hollywood');
  });

  it('detects duplicate approved slots within the same brand plan', async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes('FROM client_monthly_topics')) {
                  return { results: [
                    { slug: '724-locksmith-ca', id: 'slot-1', title: 'North Hollywood Rekeying Checklist', primary_service: 'Home rekeying', primary_area: 'North Hollywood', content_pillar: 'residential' },
                    { slug: '724-locksmith-ca', id: 'slot-2', title: 'A North Hollywood Home Rekeying Checklist', primary_service: 'Home rekeying', primary_area: 'North Hollywood', content_pillar: 'residential' },
                  ] };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(getLocksmithPortfolioTopicCollision(db, '2026-08')).resolves.toContain('slot-1');
  });
});
