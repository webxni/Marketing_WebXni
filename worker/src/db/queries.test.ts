import { describe, expect, it } from 'vitest';
import { findRecentTopicConflict } from './queries';
import type { PostRow } from '../types';

function mockDb(
  posts: PostRow[],
  options: { ownerGroup?: string | null; feedback?: Array<{ id: string; client_id: string; message: string; created_at: number }> } = {},
): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => ({ owner_group: options.ownerGroup ?? null }),
        all: async () => ({
          results: sql.includes('FROM posts')
            ? posts
            : sql.includes('FROM client_feedback') ? options.feedback ?? [] : [],
        }),
      }),
    }),
  } as unknown as D1Database;
}

function post(overrides: Partial<PostRow>): PostRow {
  return {
    id: 'existing-post',
    client_id: 'client-1',
    title: 'Existing title',
    content_type: 'video',
    target_keyword: 'Landscaping & Hardscaping Seattle',
    publish_date: '2026-08-03T10:00',
    status: 'draft',
    ...overrides,
  } as PostRow;
}

describe('findRecentTopicConflict', () => {
  it('blocks an exact target keyword reused in the same content week', async () => {
    const conflict = await findRecentTopicConflict(mockDb([post({})]), {
      clientId: 'client-1',
      candidateTitle: 'A different educational angle',
      candidateKeyword: 'landscaping and hardscaping seattle',
      contentType: 'reel',
      publishDate: '2026-08-05T10:00',
    });

    expect(conflict?.reason).toBe('target keyword already used in this content week');
  });

  it('allows the keyword in a later content week when the angle is distinct', async () => {
    const conflict = await findRecentTopicConflict(mockDb([post({})]), {
      clientId: 'client-1',
      candidateTitle: 'A completely different seasonal guide',
      candidateKeyword: 'landscaping and hardscaping seattle',
      contentType: 'reel',
      publishDate: '2026-08-17T10:00',
    });

    expect(conflict).toBeNull();
  });

  it('blocks a topic preserved from deleted portfolio editorial feedback', async () => {
    const conflict = await findRecentTopicConflict(mockDb([], {
      ownerGroup: 'gabriel-locksmiths',
      feedback: [{
        id: 'feedback-1',
        client_id: 'sibling-client',
        message: 'Editorial high: Rejected topic: Pasadena Lock Installation Tips | lock installation Pasadena.',
        created_at: 1_786_000_000,
      }],
    }), {
      clientId: 'client-1',
      candidateTitle: 'Pasadena Lock Installation Tips',
      candidateKeyword: 'lock installation Pasadena',
      publishDate: '2026-08-17T10:00',
    });

    expect(conflict?.reason).toBe('topic matched preserved rejected editorial feedback');
  });
});
