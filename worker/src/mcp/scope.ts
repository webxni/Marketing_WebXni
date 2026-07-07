/** Tenant tool allowlist + forced client scoping for the per-client MCP. */

export const MCP_READ_TOOLS = [
  'get_client_details', 'get_posts', 'get_queue', 'get_report',
  'list_client_topics', 'list_content_requests',
] as const;

export const MCP_DRAFT_TOOLS = [
  'generate_content', 'create_content_with_image', 'batch_create_content',
  'generate_captions', 'add_client_topics', 'create_content_request',
  'update_post', 'update_blog_post', 'create_offer', 'create_event',
  'attach_asset_to_post',
] as const;

export const MCP_PUBLISH_TOOLS = [
  'approve_and_publish', 'publish_post', 'publish_bulk', 'publish_blog',
  'set_post_status',
] as const;

const ALLOWED = new Set<string>([
  ...MCP_READ_TOOLS, ...MCP_DRAFT_TOOLS, ...MCP_PUBLISH_TOOLS,
]);
const PUBLISH = new Set<string>(MCP_PUBLISH_TOOLS);

export function isToolAllowed(name: string): boolean {
  return ALLOWED.has(name);
}

export function isPublishTool(name: string): boolean {
  return PUBLISH.has(name);
}

const CLIENT_KEYS = ['client', 'client_id', 'slug', 'client_slug'];

export function forceClientScope(
  args: Record<string, unknown>,
  clientSlug: string,
): Record<string, unknown> {
  const next = { ...args };
  for (const key of CLIENT_KEYS) next[key] = clientSlug;
  next.client_slugs = [clientSlug];
  return next;
}
