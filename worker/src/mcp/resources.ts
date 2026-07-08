/**
 * Read-only MCP "resources" exposing per-client business context.
 *
 * Column names below were verified against `db/schema.sql` + `db/migrations/`
 * (not just the original task brief, which guessed a few wrong):
 *   - clients.website_url does NOT exist — dropped from the profile SELECT
 *     (wp_base_url is the real "site URL" column).
 *   - client_services uses `active` (from migration 0003, which created the
 *     table first; later "CREATE TABLE IF NOT EXISTS" migrations are no-ops).
 *   - client_events has no `valid_until` column — replaced with the real
 *     `gbp_event_start_date` / `gbp_event_end_date` columns (migration 0009).
 * Everything else in the brief (clients.industry/state/phone/cta_text/brand_json,
 * client_service_areas.city/primary_area/sort_order, client_platforms.platform/
 * profile_url/username, client_offers.title/description/cta_text/valid_until,
 * client_keywords.keyword/kw_type/locality/status, client_internal_links.url/
 * anchor_keyword/active, posts columns) matched the real schema as written.
 */
export const MCP_RESOURCE_DEFS = [
  { uri: 'client://profile', name: 'Business profile', mimeType: 'application/json' },
  { uri: 'client://offers', name: 'Active offers', mimeType: 'application/json' },
  { uri: 'client://events', name: 'Events', mimeType: 'application/json' },
  { uri: 'client://approved-content', name: 'Approved content library', mimeType: 'application/json' },
  { uri: 'client://keywords', name: 'Keywords + internal links', mimeType: 'application/json' },
];

async function all<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  return r.results ?? [];
}

export async function buildResource(
  uri: string, ctx: { db: D1Database; clientId: string },
): Promise<{ uri: string; mimeType: string; text: string } | null> {
  const { db, clientId } = ctx;
  let data: unknown;
  switch (uri) {
    case 'client://profile': {
      const client = await db.prepare(
        'SELECT canonical_name, industry, state, phone, cta_text, brand_json, wp_base_url FROM clients WHERE id = ?',
      ).bind(clientId).first();
      const services = await all(db, 'SELECT name FROM client_services WHERE client_id = ? AND active = 1 ORDER BY sort_order', clientId);
      const areas = await all(db, 'SELECT city FROM client_service_areas WHERE client_id = ? ORDER BY primary_area DESC, sort_order', clientId);
      const socials = await all(db, 'SELECT platform, profile_url, username FROM client_platforms WHERE client_id = ?', clientId);
      data = { client, services, areas, socials };
      break;
    }
    case 'client://offers':
      data = await all(db, 'SELECT title, description, cta_text, valid_until FROM client_offers WHERE client_id = ? AND active = 1', clientId);
      break;
    case 'client://events':
      data = await all(db, "SELECT title, description, gbp_event_start_date, gbp_event_end_date FROM client_events WHERE client_id = ? AND active = 1", clientId);
      break;
    case 'client://approved-content':
      data = await all(db, "SELECT id, title, content_type, master_caption, wp_post_url, publish_date FROM posts WHERE client_id = ? AND status IN ('approved','ready','scheduled','posted') ORDER BY publish_date DESC LIMIT 50", clientId);
      break;
    case 'client://keywords': {
      const keywords = await all(db, "SELECT keyword, kw_type, locality FROM client_keywords WHERE client_id = ? AND status='active'", clientId);
      const links = await all(db, 'SELECT url, anchor_keyword FROM client_internal_links WHERE client_id = ? AND active = 1', clientId);
      data = { keywords, internal_links: links };
      break;
    }
    default:
      return null;
  }
  return { uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) };
}
