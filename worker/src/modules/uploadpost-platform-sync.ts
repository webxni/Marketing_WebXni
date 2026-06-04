import {
  getClientPlatforms,
  listClients,
} from '../db/queries';
import { UploadPostClient, UploadPostError } from '../services/uploadpost';
import { redactSecrets } from './redaction';
import type { Env } from '../types';

export type UploadPostPlatformSyncAction = 'created' | 'updated' | 'skipped';

export interface UploadPostPlatformSyncItem {
  client: string;
  platform: string;
  action: UploadPostPlatformSyncAction;
  account_id: string | null;
  username: string | null;
  profile_url: string | null;
  details: Record<string, string | null>;
}

export interface UploadPostPlatformSyncResult {
  ok: boolean;
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  synced: UploadPostPlatformSyncItem[];
  errors: Array<{ client: string; error: string }>;
  content: string;
}

export function normalizeUploadPostPlatform(raw: string): string {
  const map: Record<string, string> = {
    instagram_business: 'instagram',
    instagram_creator: 'instagram',
    tiktok_business: 'tiktok',
    twitter: 'x',
    'google-business': 'google_business',
    gmb: 'google_business',
  };
  const lower = raw.toLowerCase().replace(/[ -]+/g, '_');
  return map[lower] ?? lower;
}

function textValue(value: unknown, max = 300): string | null {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

export function extractUploadPostAccountDetails(details: unknown): {
  account_id: string | null;
  username: string | null;
  profile_url: string | null;
} {
  if (!details || typeof details !== 'object') return { account_id: null, username: null, profile_url: null };
  const row = details as Record<string, unknown>;
  return {
    account_id: textValue(row.id ?? row.account_id ?? row.user_id, 120),
    username: textValue(row.username ?? row.name ?? row.display_name, 120),
    profile_url: textValue(row.profile_url ?? row.url ?? row.link, 300),
  };
}

function objectMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstId(rows: Array<Record<string, unknown>>, keys: string[]): string | null {
  if (rows.length !== 1) return null;
  for (const key of keys) {
    const value = textValue(rows[0][key], 180);
    if (value) return value;
  }
  return null;
}

async function fetchSinglePlatformIds(up: UploadPostClient, profile: string): Promise<Record<string, Record<string, string | null>>> {
  const result: Record<string, Record<string, string | null>> = {};

  try {
    const payload = await up.getGbpLocations(profile) as { locations?: Array<Record<string, unknown>> };
    const locationId = firstId(payload.locations ?? [], ['location_id', 'id', 'name']);
    if (locationId) result.google_business = { upload_post_location_id: locationId };
  } catch { /* optional provider data */ }

  try {
    const payload = await up.getPinterestBoards(profile) as { boards?: Array<Record<string, unknown>> };
    const boardId = firstId(payload.boards ?? [], ['board_id', 'id']);
    if (boardId) result.pinterest = { upload_post_board_id: boardId };
  } catch { /* optional provider data */ }

  try {
    const payload = await up.getLinkedinPages(profile) as { pages?: Array<Record<string, unknown>> };
    const pageId = firstId(payload.pages ?? [], ['page_id', 'id', 'urn']);
    if (pageId) result.linkedin = { page_id: pageId, linkedin_urn: pageId.startsWith('urn:') ? pageId : null };
  } catch { /* optional provider data */ }

  return result;
}

export async function syncUploadPostClientPlatforms(
  env: Env,
  options: { client_slug?: string; dry_run?: boolean } = {},
): Promise<UploadPostPlatformSyncResult> {
  const dryRun = options.dry_run === true;
  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  const clients = options.client_slug
    ? await listClients(env.DB, 'all').then((all) => all.filter((client) => client.slug === options.client_slug))
    : await listClients(env.DB, 'active');

  const synced: UploadPostPlatformSyncItem[] = [];
  const errors: Array<{ client: string; error: string }> = [];

  for (const client of clients) {
    if (!client.upload_post_profile) {
      errors.push({ client: client.slug, error: 'Upload-Post profile is not configured.' });
      continue;
    }

    let profile: Record<string, unknown>;
    try {
      profile = await up.getProfile(client.upload_post_profile) as Record<string, unknown>;
    } catch (err) {
      const raw = err instanceof UploadPostError ? err.body : err instanceof Error ? err.message : String(err);
      errors.push({ client: client.slug, error: redactSecrets(raw).slice(0, 180) });
      continue;
    }

    const profileObject = objectMap(profile.profile);
    const socialAccounts = objectMap(profile.social_accounts ?? profileObject.social_accounts);
    const singleIds = await fetchSinglePlatformIds(up, client.upload_post_profile);
    const discovered = new Map<string, {
      account_id: string | null;
      username: string | null;
      profile_url: string | null;
      details: Record<string, string | null>;
    }>();

    for (const [rawPlatform, details] of Object.entries(socialAccounts)) {
      const platform = normalizeUploadPostPlatform(rawPlatform);
      const extracted = extractUploadPostAccountDetails(details);
      discovered.set(platform, {
        ...extracted,
        details: singleIds[platform] ?? {},
      });
    }

    for (const [platform, details] of Object.entries(singleIds)) {
      if (!discovered.has(platform)) {
        discovered.set(platform, {
          account_id: null,
          username: null,
          profile_url: null,
          details,
        });
      } else {
        discovered.get(platform)!.details = { ...discovered.get(platform)!.details, ...details };
      }
    }

    if (discovered.size === 0) continue;

    const existing = await getClientPlatforms(env.DB, client.id);
    const byPlatform = new Map(existing.map((row) => [row.platform, row]));

    for (const [platform, data] of discovered) {
      const existingRow = byPlatform.get(platform);
      const values = {
        account_id: data.account_id,
        username: data.username,
        profile_url: data.profile_url,
        upload_post_board_id: data.details.upload_post_board_id ?? null,
        upload_post_location_id: data.details.upload_post_location_id ?? null,
        page_id: data.details.page_id ?? null,
        linkedin_urn: data.details.linkedin_urn ?? null,
      };

      if (existingRow) {
        const existingValues = existingRow as unknown as Record<string, unknown>;
        const hasBetterData = Object.entries(values).some(([key, value]) => value && !String(existingValues[key] ?? '').trim());
        if (!dryRun && hasBetterData) {
          await env.DB.prepare(`
            UPDATE client_platforms
            SET account_id = COALESCE(?, account_id),
                username = COALESCE(?, username),
                profile_url = COALESCE(?, profile_url),
                upload_post_board_id = COALESCE(?, upload_post_board_id),
                upload_post_location_id = COALESCE(?, upload_post_location_id),
                page_id = COALESCE(?, page_id),
                linkedin_urn = COALESCE(?, linkedin_urn),
                connection_status = 'connected'
            WHERE client_id = ? AND platform = ?
          `).bind(
            values.account_id,
            values.username,
            values.profile_url,
            values.upload_post_board_id,
            values.upload_post_location_id,
            values.page_id,
            values.linkedin_urn,
            client.id,
            platform,
          ).run();
        }
        synced.push({
          client: client.slug,
          platform,
          action: hasBetterData ? 'updated' : 'skipped',
          account_id: data.account_id,
          username: data.username,
          profile_url: data.profile_url,
          details: data.details,
        });
        continue;
      }

      if (!dryRun) {
        await env.DB.prepare(`
          INSERT INTO client_platforms
            (id, client_id, platform, account_id, username, profile_url,
             upload_post_board_id, upload_post_location_id, page_id, linkedin_urn, connection_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected')
        `).bind(
          crypto.randomUUID().replace(/-/g, '').toLowerCase(),
          client.id,
          platform,
          values.account_id,
          values.username,
          values.profile_url,
          values.upload_post_board_id,
          values.upload_post_location_id,
          values.page_id,
          values.linkedin_urn,
        ).run();
      }
      synced.push({
        client: client.slug,
        platform,
        action: 'created',
        account_id: data.account_id,
        username: data.username,
        profile_url: data.profile_url,
        details: data.details,
      });
    }
  }

  const created = synced.filter((item) => item.action === 'created').length;
  const updated = synced.filter((item) => item.action === 'updated').length;
  const skipped = synced.filter((item) => item.action === 'skipped').length;
  const content = [
    `**Platform sync ${dryRun ? '(dry run)' : 'complete'}**`,
    `Created: ${created} | Updated: ${updated} | Existing unchanged: ${skipped} | Errors: ${errors.length}`,
    ...synced
      .filter((item) => item.action !== 'skipped')
      .map((item) => `• ${item.client} / ${item.platform}${item.username ? ` @${item.username}` : ''}`),
    ...(errors.length ? ['', '**Errors:**', ...errors.map((err) => `• ${err.client}: ${err.error.slice(0, 120)}`)] : []),
  ].join('\n');

  return { ok: errors.length === 0, dry_run: dryRun, created, updated, skipped, synced, errors, content };
}
