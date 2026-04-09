/**
 * LOADER worker — receives background job requests from main Worker
 * Dispatches to the appropriate long-running handler.
 *
 * Routes:
 *   POST https://loader/run-posting   → runPosting()
 *   POST https://loader/fetch-urls    → fetchUrls()
 *   POST https://loader/run-generation → runGeneration() (Phase 1 / Phase 2)
 */
import type { Env } from '../types';
import { runPosting } from './posting-run';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (path === '/run-posting') {
      const mode = (body['mode'] as string) === 'dry_run' ? 'dry_run' : 'real';
      const stats = await runPosting(env, {
        mode,
        client_filter: body['client_filter'] as string | undefined,
        platform_filter: body['platform_filter'] as string | undefined,
        limit: body['limit'] as number | undefined,
        triggered_by: body['triggered_by'] as string | undefined,
      });
      return Response.json({ ok: true, stats });
    }

    if (path === '/fetch-urls') {
      // TODO: port fetch_and_writeback_urls()
      return Response.json({ ok: true, message: 'fetch-urls not yet implemented' });
    }

    if (path === '/run-generation') {
      // TODO: OpenAI content generation Phase 1 / Phase 2
      return Response.json({ ok: true, message: 'generation not yet implemented' });
    }

    return new Response('Not found', { status: 404 });
  },
};
