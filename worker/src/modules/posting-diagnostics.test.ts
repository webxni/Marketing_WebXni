import { describe, expect, it } from 'vitest';
import { getConnectionHealth } from './posting-diagnostics';

const configuredPlatform = { id: 'platform' } as never;

describe('getConnectionHealth', () => {
  it('marks an account unhealthy when Upload-Post requires reauthentication', () => {
    const health = getConnectionHealth('reddit', configuredPlatform, {
      social_accounts: {
        reddit: { username: 'example', reauth_required: true },
      },
    }, { ok: true, message: 'Connected account found in Upload-Post profile.' });

    expect(health).toMatchObject({
      configured: true,
      connected: false,
      status: 'failed',
      message: 'Upload-Post account requires reauthentication.',
    });
  });

  it('keeps a connected account healthy when reauthentication is not required', () => {
    const health = getConnectionHealth('reddit', configuredPlatform, {
      social_accounts: {
        reddit: { username: 'example', reauth_required: false },
      },
    }, { ok: true });

    expect(health).toMatchObject({
      configured: true,
      connected: true,
      status: 'connected',
    });
  });
});
