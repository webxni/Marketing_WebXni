/**
 * Platform health check — audits Upload-Post connections for all active clients,
 * updates connection_status in client_platforms, and returns a structured report.
 */
import { UploadPostClient, UploadPostError } from '../services/uploadpost';
import { getConnectionHealth, type UploadPostProfileResponse } from './posting-diagnostics';
import { listClients, getClientPlatforms, getClientGbpLocations } from '../db/queries';
import type { ClientPlatformRow, Env } from '../types';

export interface PlatformIssue {
  platform: string;
  prev_status: string | null;
  new_status: string;
  message: string;
}

export interface GbpLocationFix {
  location_id: string;
  auto_set: boolean;
}

export interface ClientHealthReport {
  slug: string;
  canonical_name: string;
  profile: string | null;
  profile_ok: boolean;
  issues: PlatformIssue[];
  gbp_fix: GbpLocationFix | null;
  total_platforms: number;
  failed_platforms: number;
}

export interface PlatformHealthSummary {
  checked_at: string;
  clients_checked: number;
  clients_with_issues: number;
  total_failed: number;
  total_fixed_gbp: number;
  reports: ClientHealthReport[];
}

export async function runPlatformHealthCheck(env: Env): Promise<PlatformHealthSummary> {
  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);
  const clients = await listClients(env.DB, 'active');

  const reports: ClientHealthReport[] = [];

  for (const client of clients) {
    const report = await checkClientPlatforms(env.DB, up, client);
    reports.push(report);
  }

  const clientsWithIssues = reports.filter((r) => r.failed_platforms > 0 || !r.profile_ok).length;
  const totalFailed = reports.reduce((sum, r) => sum + r.failed_platforms, 0);
  const totalFixedGbp = reports.filter((r) => r.gbp_fix?.auto_set).length;

  return {
    checked_at: new Date().toISOString(),
    clients_checked: clients.length,
    clients_with_issues: clientsWithIssues,
    total_failed: totalFailed,
    total_fixed_gbp: totalFixedGbp,
    reports,
  };
}

async function checkClientPlatforms(
  db: D1Database,
  up: UploadPostClient,
  client: { id: string; slug: string; canonical_name: string; upload_post_profile: string | null },
): Promise<ClientHealthReport> {
  const profile = client.upload_post_profile;
  const platforms = await getClientPlatforms(db, client.id);
  const gbpLocations = await getClientGbpLocations(db, client.id);

  if (!profile) {
    return {
      slug: client.slug,
      canonical_name: client.canonical_name,
      profile: null,
      profile_ok: false,
      issues: platforms.map((p) => ({
        platform: p.platform,
        prev_status: p.connection_status ?? null,
        new_status: 'failed',
        message: 'No Upload-Post profile configured.',
      })),
      gbp_fix: null,
      total_platforms: platforms.length,
      failed_platforms: platforms.length,
    };
  }

  // Fetch profile from Upload-Post
  let profilePayload: UploadPostProfileResponse | null = null;
  let profileOk = false;

  try {
    profilePayload = (await up.getProfile(profile)) as UploadPostProfileResponse;
    profileOk = true;
  } catch (err) {
    const msg = err instanceof UploadPostError ? err.body : String(err);
    return {
      slug: client.slug,
      canonical_name: client.canonical_name,
      profile,
      profile_ok: false,
      issues: platforms.map((p) => ({
        platform: p.platform,
        prev_status: p.connection_status ?? null,
        new_status: 'failed',
        message: `Upload-Post profile unreachable: ${msg.slice(0, 120)}`,
      })),
      gbp_fix: null,
      total_platforms: platforms.length,
      failed_platforms: platforms.length,
    };
  }

  // Build probes
  const locationProbe = async () => {
    try {
      // Group locations by their own upload_post_profile (multi-profile clients like ETB use different profiles per location)
      const activeLocations = gbpLocations.filter((l) => l.paused !== 1);
      if (activeLocations.length === 0) {
        // Nothing expected — probe passes (single-location GBP via client_platforms.upload_post_location_id is validated separately)
        return { ok: true, message: 'OK', details: { expected: [], returned: [] } };
      }
      const byProfile = new Map<string, string[]>();
      for (const loc of activeLocations) {
        const p = loc.upload_post_profile ?? profile;
        if (!byProfile.has(p)) byProfile.set(p, []);
        byProfile.get(p)!.push(loc.location_id);
      }
      const missing: string[] = [];
      for (const [locProfile, expectedIds] of byProfile) {
        const r = (await up.getGbpLocations(locProfile)) as { locations?: Array<Record<string, unknown>> };
        const returned = (r.locations ?? []).map((l) => String(l.location_id ?? l.id ?? ''));
        missing.push(...expectedIds.filter((id) => !returned.includes(id)));
      }
      return { ok: missing.length === 0, message: missing.length ? `Missing: ${missing.join(', ')}` : 'OK', details: { activeLocations: activeLocations.length } };
    } catch (err) {
      return { ok: false, message: err instanceof UploadPostError ? err.body : String(err) };
    }
  };

  const boardProbe = async () => {
    try {
      const r = (await up.getPinterestBoards(profile)) as { boards?: Array<Record<string, unknown>> };
      const expected = platforms.filter((p) => p.platform === 'pinterest' && p.upload_post_board_id).map((p) => String(p.upload_post_board_id));
      const returned = (r.boards ?? []).map((b) => String(b.id ?? b.board_id ?? ''));
      const missing = expected.filter((id) => !returned.includes(id));
      return { ok: missing.length === 0, message: missing.length ? `Missing boards: ${missing.join(', ')}` : 'OK', details: { expected, returned } };
    } catch (err) {
      return { ok: false, message: err instanceof UploadPostError ? err.body : String(err) };
    }
  };

  const linkedinProbe = async () => {
    try {
      const r = (await up.getLinkedinPages(profile)) as { pages?: Array<Record<string, unknown>> };
      const expected = platforms.filter((p) => p.platform === 'linkedin' && p.page_id).map((p) => String(p.page_id));
      const returned = (r.pages ?? []).map((pg) => String(pg.id ?? pg.page_id ?? pg.urn ?? ''));
      // Normalize URN comparison: "112939025" matches "urn:li:organization:112939025"
      const normalizeId = (id: string) => id.replace(/^urn:li:[^:]+:/, '');
      const returnedNorm = returned.map(normalizeId);
      const missing = expected.filter((id) => !returnedNorm.includes(normalizeId(id)));
      if (returned.length === 0 && expected.length === 0) {
        return { ok: true, message: 'LinkedIn connected (no page targeting configured).', details: { expected, returned } };
      }
      return {
        ok: missing.length === 0 && returned.length > 0,
        message: returned.length === 0 ? 'No LinkedIn pages in Upload-Post' : (missing.length ? `Missing pages: ${missing.join(', ')}` : 'OK'),
        details: { expected, returned },
      };
    } catch (err) {
      return { ok: false, message: err instanceof UploadPostError ? err.body : String(err) };
    }
  };

  const probeFor = async (platform: string) => {
    if (platform === 'google_business') return locationProbe();
    if (platform === 'pinterest') return boardProbe();
    if (platform === 'linkedin') return linkedinProbe();
    return { ok: true, message: 'OK' };
  };

  // Run all platform checks
  const issues: PlatformIssue[] = [];
  const byPlatform = new Map(platforms.map((p) => [p.platform, p]));
  const allPlatforms = Array.from(
    new Set([...platforms.map((p) => p.platform), ...Object.keys(profilePayload?.social_accounts ?? {})]),
  ).sort();

  for (const platform of allPlatforms) {
    const cfg = byPlatform.get(platform) ?? null;
    const probe = await probeFor(platform);
    let health = getConnectionHealth(platform, cfg, profilePayload, probe);

    // Downgrade 'failed' to 'not_configured' when there is simply no account in Upload-Post
    // for this platform (platform was never connected, not a broken connection).
    // Real failures — probe errors, missing GBP locations, etc. — keep status 'failed'.
    if (
      health.status === 'failed' &&
      health.message === 'No connected account found in Upload-Post for this platform.'
    ) {
      health = { ...health, status: 'not_configured', message: 'Not connected in Upload-Post — configure when ready.' };
    }

    // Update DB connection_status if it changed
    if (cfg && cfg.connection_status !== health.status) {
      try {
        await db
          .prepare('UPDATE client_platforms SET connection_status = ?, updated_at = ? WHERE id = ?')
          .bind(health.status, Math.floor(Date.now() / 1000), cfg.id)
          .run();
      } catch { /* non-fatal */ }
    }

    if (health.status !== 'connected') {
      issues.push({
        platform,
        prev_status: cfg?.connection_status ?? null,
        new_status: health.status,
        message: health.message,
      });
    }
  }

  // Auto-fix GBP NOT_LINKED: if Upload-Post returns exactly one location and our DB has NOT_LINKED
  let gbpFix: GbpLocationFix | null = null;
  const gbpCfg = byPlatform.get('google_business');
  if (gbpCfg && (gbpCfg.upload_post_location_id === 'NOT_LINKED' || !gbpCfg.upload_post_location_id)) {
    try {
      const r = (await up.getGbpLocations(profile)) as { locations?: Array<Record<string, unknown>> };
      const locs = r.locations ?? [];
      if (locs.length === 1) {
        const locId = String(locs[0].location_id ?? locs[0].id ?? '');
        if (locId && locId !== 'NOT_LINKED') {
          await db
            .prepare('UPDATE client_platforms SET upload_post_location_id = ?, updated_at = ? WHERE id = ?')
            .bind(locId, Math.floor(Date.now() / 1000), gbpCfg.id)
            .run();
          gbpFix = { location_id: locId, auto_set: true };
          // Remove from issues since it's now fixed
          const idx = issues.findIndex((i) => i.platform === 'google_business');
          if (idx !== -1) issues.splice(idx, 1);
        }
      } else if (locs.length > 1) {
        gbpFix = { location_id: locs.map((l) => String(l.location_id ?? l.id ?? '')).join(', '), auto_set: false };
      }
    } catch { /* non-fatal */ }
  }

  // Warn if GBP is "connected" but location ID is still NOT_LINKED or empty
  const gbpCfgPost = byPlatform.get('google_business');
  if (
    gbpCfgPost &&
    gbpCfgPost.connection_status === 'connected' &&
    (!gbpCfgPost.upload_post_location_id || gbpCfgPost.upload_post_location_id === 'NOT_LINKED') &&
    !issues.find((i) => i.platform === 'google_business')
  ) {
    issues.push({
      platform: 'google_business',
      prev_status: 'connected',
      new_status: 'warning',
      message: 'GBP connected but location ID is not set — posts will fail without a valid location ID.',
    });
  }

  const failed = issues.filter((i) => i.new_status === 'failed').length;
  return {
    slug: client.slug,
    canonical_name: client.canonical_name,
    profile,
    profile_ok: profileOk,
    issues,
    gbp_fix: gbpFix,
    total_platforms: allPlatforms.length,
    failed_platforms: failed,
  };
}

export function buildHealthDiscordMessage(summary: PlatformHealthSummary): {
  title: string;
  description: string;
  status: 'ok' | 'warning' | 'error';
  fields: Array<{ name: string; value: string; inline?: boolean }>;
} {
  const status = summary.total_failed === 0 ? 'ok' : summary.total_failed <= 3 ? 'warning' : 'error';

  const title = status === 'ok'
    ? '✅ Plataformas — Todo conectado'
    : `⚠️ Plataformas — ${summary.total_failed} falla${summary.total_failed !== 1 ? 's' : ''} detectada${summary.total_failed !== 1 ? 's' : ''}`;

  const description = status === 'ok'
    ? `Se verificaron **${summary.clients_checked} clientes** — todas las plataformas están conectadas correctamente.`
    : `Se verificaron **${summary.clients_checked} clientes** — **${summary.clients_with_issues}** con problemas de conexión.`;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  // Summary counts
  fields.push({
    name: '📊 Resumen',
    value: [
      `Clientes: ${summary.clients_checked}`,
      `Con fallas: ${summary.clients_with_issues}`,
      `Total fallas: ${summary.total_failed}`,
      summary.total_fixed_gbp > 0 ? `GBP auto-fijados: ${summary.total_fixed_gbp}` : null,
    ].filter(Boolean).join('\n'),
    inline: true,
  });

  // List clients with issues
  const problemClients = summary.reports.filter((r) => r.failed_platforms > 0 || !r.profile_ok);
  if (problemClients.length > 0) {
    const lines = problemClients.slice(0, 8).map((r) => {
      const platforms = r.issues.map((i) => i.platform).join(', ');
      return `**${r.canonical_name}**: ${platforms}`;
    });
    if (problemClients.length > 8) lines.push(`...y ${problemClients.length - 8} más`);
    fields.push({ name: '🔴 Clientes con fallas', value: lines.join('\n') });
  }

  // GBP fixes
  const gbpFixed = summary.reports.filter((r) => r.gbp_fix?.auto_set);
  if (gbpFixed.length > 0) {
    fields.push({
      name: '🗺️ GBP auto-corregidos',
      value: gbpFixed.map((r) => `**${r.canonical_name}**: \`${r.gbp_fix!.location_id}\``).join('\n'),
    });
  }

  // GBP needing manual selection
  const gbpManual = summary.reports.filter((r) => r.gbp_fix && !r.gbp_fix.auto_set);
  if (gbpManual.length > 0) {
    fields.push({
      name: '📍 GBP — Selección manual requerida',
      value: gbpManual.map((r) => `**${r.canonical_name}**: ${r.gbp_fix!.location_id}`).join('\n'),
    });
  }

  return { title, description, status, fields };
}
