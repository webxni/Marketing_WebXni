/**
 * LOADER: Posting run — full port of post_content.py run()
 * Executed in background by LOADER binding.
 * Handles: dry-run, real posting, multi-location GBP, idempotency, writeback.
 */
import type { LoaderEnv, ClientGbpLocationRow, PostRow } from '../types';
import {
  listReadyPosts,
  getClientWithConfig,
  createPostingJob,
  updatePostingJob,
  upsertPostPlatform,
  setPostStatus,
  writeAuditLog,
} from '../db/queries';
import { UploadPostClient, UploadPostError } from '../services/uploadpost';
import { preflight } from '../modules/preflight';
import { makeIdempotencyKey } from '../modules/idempotency';
import { getCaption, normalizePlatform, SKIP_PLATFORMS } from '../modules/captions';
import { getGbpCaptionField, getGbpPostedKey, normalizeContentType } from '../modules/platform-compatibility';
import {
  getScheduledTime,
  isVideoUrl,
  inferMediaTypeFromAssetType,
  requiresMedia,
} from '../modules/media';
import { buildExtraParams, extractTrackingId } from '../modules/posting';
import { translatePostingError } from '../modules/posting-diagnostics';

export interface PostingRunParams {
  mode: 'dry_run' | 'real';
  job_id?: string;          // pass from caller to avoid double job creation
  client_filter?: string;
  platform_filter?: string;
  post_ids?: string[];
  limit?: number;
  triggered_by?: string;
}

export interface PostingStats {
  processed: number;
  posted: number;
  skipped: number;
  blocked: number;
  failed: number;
}

export async function runPosting(env: LoaderEnv, params: PostingRunParams): Promise<PostingStats> {
  const dryRun = params.mode === 'dry_run';
  const stats: PostingStats = { processed: 0, posted: 0, skipped: 0, blocked: 0, failed: 0 };

  // job_id may be passed by a caller that already created the record (e.g. run.ts /api/run/post).
  // For cron invocations we create it lazily after confirming there are posts to process,
  // so the posting_jobs table stays clean when the per-minute cron finds nothing due.
  let jobId = params.job_id;

  const up = new UploadPostClient(env.UPLOAD_POST_API_KEY);

  try {
    const posts = await listReadyPosts(env.DB, params.client_filter, params.limit ?? 50, params.post_ids);

    // Skip job creation and early-return when there is nothing to post.
    // This keeps posting_jobs clean when the per-minute cron fires with no due posts.
    if (posts.length === 0 && !jobId && !dryRun) {
      return stats;
    }

    // Lazily create the job record now that we know there's real work to do.
    if (!jobId) {
      const job = await createPostingJob(env.DB, {
        triggered_by: params.triggered_by ?? 'api',
        mode: params.mode,
        client_filter: params.client_filter,
        platform_filter: params.platform_filter,
        limit_count: params.limit ?? 50,
      });
      jobId = job.id;
    }

    for (const post of posts) {
      await processPost(env, up, post, params, stats, dryRun, jobId);
    }

    if (jobId) await updatePostingJob(env.DB, jobId, 'completed', JSON.stringify(stats));
  } catch (err) {
    if (jobId) {
      await updatePostingJob(
        env.DB,
        jobId,
        'failed',
        JSON.stringify({ ...stats, error: String(err) }),
      );
    }
    throw err;
  }

  return stats;
}

async function processPost(
  env: LoaderEnv,
  up: UploadPostClient,
  post: PostRow,
  params: PostingRunParams,
  stats: PostingStats,
  dryRun: boolean,
  jobId: string,
): Promise<void> {
  stats.processed++;

  // Per-post counters — status update must use these, NOT global stats
  // (global stats accumulate across all posts and would produce wrong status)
  let thisPosted = 0;
  let thisFailed = 0;

  const client = await getClientWithConfig(env.DB, post.client_id);
  if (!client) {
    await writeError(env.DB, post.id, 'Client not found in DB');
    stats.skipped++;
    return;
  }

  const platforms: string[] = JSON.parse(post.platforms ?? '[]');
  const publishDate = post.publish_date ?? 'nodate';
  const sched_time = getScheduledTime(post.publish_date);
  const normalizedContentType = normalizeContentType(post.content_type, post.asset_type);

  // Detect media kind
  let mediaKind: 'image' | 'video' | null = null;
  let mediaUrl: string | null = null;

  if (normalizedContentType === 'reel' || normalizedContentType === 'video') {
    mediaKind = 'video';
    mediaUrl = post.asset_r2_key;
  } else if (post.asset_r2_key) {
    mediaUrl = post.asset_r2_key; // Will be resolved to R2 URL or Drive URL below
    if (isVideoUrl(post.asset_r2_key)) {
      mediaKind = 'video';
    } else {
      mediaKind = inferMediaTypeFromAssetType(post.asset_type) ?? 'image';
    }
  }

  // Guard: image/video posts require an asset
  if (!post.asset_r2_key && requiresMedia(post.content_type ?? '')) {
    const msg =
      'Image/video post requires Asset URL — upload to R2 then set asset_r2_key in DB.';
    if (!dryRun) await writeError(env.DB, post.id, msg);
    stats.skipped++;
    return;
  }

  // Download image bytes once (reused across platforms)
  // Videos are passed as URL — never buffered
  let photoBytes: ArrayBuffer | null = null;
  let photoContentType = 'image/jpeg';
  let photoFilename = 'image.jpg';

  if (mediaUrl && mediaKind === 'image' && !dryRun) {
    const obj = await env.MEDIA.get(post.asset_r2_key!);
    if (obj) {
      photoBytes = await obj.arrayBuffer();
      photoContentType = obj.httpMetadata?.contentType ?? 'image/jpeg';
      photoFilename = post.asset_r2_key!.split('/').pop() ?? 'image.jpg';
    }
  }

  // Resolve video R2 URL — requires MEDIA bucket to have public access enabled.
  // Set R2_MEDIA_PUBLIC_URL in wrangler.toml [vars] after enabling public access
  // in Cloudflare R2 dashboard (format: https://pub-<hash>.r2.dev or custom domain).
  let videoR2Url: string | null = null;
  if (mediaKind === 'video' && post.asset_r2_key && env.R2_MEDIA_PUBLIC_URL) {
    videoR2Url = `${env.R2_MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${post.asset_r2_key}`;
  }

  for (const notionPlatform of platforms) {
    const platform = normalizePlatform(notionPlatform);

    // Apply --platform filter
    if (params.platform_filter && platform !== normalizePlatform(params.platform_filter)) {
      continue;
    }

    // Skip non-Upload-Post platforms
    if (SKIP_PLATFORMS.has(platform)) {
      continue;
    }

    // Multi-location GBP (ETB has LA/WA/OR)
    if (platform === 'google_business' && client.gbp_locations.length > 0) {
      await postGbpMultiLocation(
        env, up, post, client, sched_time, publishDate,
        photoBytes, photoContentType, photoFilename,
        videoR2Url, mediaKind, dryRun, stats, jobId,
      );
      continue;
    }

    const caption = getCaption(post, platform);

    const result = await preflight(client, platform, caption);
    if (!result.ok) {
      const reasonEs = translatePostingError(result.reason, platform);
      if (result.tag === 'BLOCKED') stats.blocked++;
      else stats.skipped++;
      // Record skip/blocked in post_platforms
      if (!dryRun) {
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform,
          status: result.tag.toLowerCase(),
          error_message: reasonEs,
        });
        await logPostingAudit(env.DB, post.id, platform, result.tag.toLowerCase(), reasonEs, result.reason);
      }
      continue;
    }

    // Anti-duplicate: skip if already posted
    if (!dryRun) {
      const existing = await env.DB
        .prepare('SELECT tracking_id FROM post_platforms WHERE post_id = ? AND platform = ?')
        .bind(post.id, platform)
        .first<{ tracking_id: string | null }>();
      if (existing?.tracking_id) {
        stats.skipped++;
        continue;
      }
    }

    const platCfg = client.platforms.find((p) => normalizePlatform(p.platform) === platform);
    if (!platCfg) continue;

    const extra = buildExtraParams(platform, platCfg, post);
    const idemKey = await makeIdempotencyKey(post.id, platform, publishDate);

    if (dryRun) {
      const endpoint =
        mediaKind === 'video'
          ? 'POST /api/upload (video)'
          : mediaKind === 'image'
            ? 'POST /api/upload_photos (photo)'
            : 'POST /api/upload_text (text)';
      console.log(`[DRY-RUN] ${post.title} → ${platform}`);
      console.log(`  endpoint: ${endpoint}`);
      console.log(`  user: ${client.upload_post_profile}`);
      console.log(`  scheduled: ${sched_time}`);
      console.log(`  idem_key: ${idemKey}`);
      console.log(`  caption: ${(caption ?? '').slice(0, 100)}...`);
      continue;
    }

    // ── Real post ──────────────────────────────────────────────────────────
    try {
      let response;

      if (mediaKind === 'video' && videoR2Url) {
        response = await up.postVideo({
          user: client.upload_post_profile!,
          platform,
          title: caption!,
          videoUrl: videoR2Url,
          content_type: normalizedContentType === 'reel' ? 'reel' : 'video',
          scheduled_date: sched_time,
          idempotency_key: idemKey,
          ...extra,
        });
      } else if (mediaKind === 'image' && photoBytes) {
        response = await up.postPhoto({
          user: client.upload_post_profile!,
          platform,
          title: caption!,
          photoBytes,
          photoFilename,
          photoContentType,
          scheduled_date: sched_time,
          idempotency_key: idemKey,
          ...extra,
        });
      } else {
        response = await up.postText({
          user: client.upload_post_profile!,
          platform,
          title: caption!,
          scheduled_date: sched_time,
          idempotency_key: idemKey,
          ...extra,
        });
      }

      const trackingId = extractTrackingId(response);
      if (trackingId) {
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform,
          tracking_id: `UP:${trackingId}`,
          status: 'sent',
          idempotency_key: idemKey,
        });
      }
      await logPostingAudit(env.DB, post.id, platform, 'sent', 'Publicación enviada a Upload-Post.', response);
      stats.posted++;
      thisPosted++;
    } catch (err) {
      if (err instanceof UploadPostError && err.isIdempotent) {
        // Already submitted — mark as sent
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform,
          tracking_id: `UP:IDEM:${idemKey}`,
          status: 'idempotent',
          idempotency_key: idemKey,
        });
        await logPostingAudit(env.DB, post.id, platform, 'idempotent', 'Upload-Post indicó que esta publicación ya existía.', err.body);
        stats.posted++;
        thisPosted++;
      } else {
        const rawMsg = err instanceof UploadPostError
          ? `HTTP ${err.status}: ${err.body.slice(0, 300)}`
          : String(err);
        const msg = translatePostingError(rawMsg, platform);
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform,
          status: 'failed',
          error_message: msg,
          idempotency_key: idemKey,
        });
        await logPostingAudit(env.DB, post.id, platform, 'failed', msg, rawMsg);
        stats.failed++;
        thisFailed++;
      }
    }
  }

  // Post-loop: update post status using per-post counters (not global stats)
  if (!dryRun) {
    if (thisPosted > 0) {
      await setPostStatus(env.DB, post.id, 'scheduled', 'Posted');

      // Clean up R2 asset only when ALL platforms for this post succeeded
      if (thisFailed === 0 && post.asset_r2_key) {
        try {
          const bucket = post.asset_r2_bucket === 'IMAGES' ? env.IMAGES : env.MEDIA;
          await bucket.delete(post.asset_r2_key);
          await env.DB
            .prepare('UPDATE posts SET asset_r2_key = NULL, asset_r2_bucket = NULL WHERE id = ?')
            .bind(post.id)
            .run();
        } catch {
          console.warn(`[posting-run] R2 cleanup failed for post ${post.id}`);
        }
      }
    } else if (thisFailed > 0) {
      await setPostStatus(env.DB, post.id, 'failed', 'Failed');
    } else {
      // All platforms were skipped — write a diagnostic note so it's visible
      console.warn(
        `[posting-run] Post ${post.id} "${post.title}" — all platforms skipped (Upload-Post not configured or preflight blocked). ` +
        `Check client '${client?.slug}' upload_post_profile and platform configs.`,
      );
    }
  }
}

async function postGbpMultiLocation(
  env: LoaderEnv,
  up: UploadPostClient,
  post: PostRow,
  client: Awaited<ReturnType<typeof getClientWithConfig>>,
  schedTime: string,
  publishDate: string,
  photoBytes: ArrayBuffer | null,
  photoContentType: string,
  photoFilename: string,
  videoR2Url: string | null,
  mediaKind: 'image' | 'video' | null,
  dryRun: boolean,
  stats: PostingStats,
  _jobId: string,
): Promise<void> {
  if (!client) return;

  const locations: ClientGbpLocationRow[] = client.gbp_locations;

  for (const loc of locations) {
    if (loc.paused === 1) {
      stats.skipped++;
      continue;
    }

    // Get location-specific caption field (e.g. cap_gbp_la)
    const captionField = getGbpCaptionField(loc);
    const caption =
      (captionField ? (post[captionField] as string | null) : null) ??
      post.cap_google_business;

    if (!caption) {
      stats.skipped++;
      continue;
    }

    const platformKey = `google_business_${loc.label.toLowerCase()}`;
    const idemKey = await makeIdempotencyKey(post.id, platformKey, publishDate);
    const profile = loc.upload_post_profile ?? client.upload_post_profile!;

    if (dryRun) {
      console.log(`[DRY-RUN] GBP ${loc.label}: ${loc.location_id}`);
      console.log(`  caption: ${caption.slice(0, 100)}...`);
      continue;
    }

    // Anti-duplicate check
    const postedField = getGbpPostedKey(loc);
    const existing = await env.DB
      .prepare('SELECT tracking_id FROM post_platforms WHERE post_id = ? AND platform = ?')
      .bind(post.id, postedField)
      .first<{ tracking_id: string | null }>();
    if (existing?.tracking_id) {
      stats.skipped++;
      continue;
    }

    const extra = { gbp_location_id: loc.location_id };

    try {
      let response;
      if (mediaKind === 'video' && videoR2Url) {
        response = await up.postVideo({
          user: profile,
          platform: 'google_business',
          title: caption,
          videoUrl: videoR2Url,
          content_type: 'video',
          scheduled_date: schedTime,
          idempotency_key: idemKey,
          ...extra,
        });
      } else if (mediaKind === 'image' && photoBytes) {
        response = await up.postPhoto({
          user: profile,
          platform: 'google_business',
          title: caption,
          photoBytes,
          photoFilename,
          photoContentType,
          scheduled_date: schedTime,
          idempotency_key: idemKey,
          ...extra,
        });
      } else {
        response = await up.postText({
          user: profile,
          platform: 'google_business',
          title: caption,
          scheduled_date: schedTime,
          idempotency_key: idemKey,
          ...extra,
        });
      }

      const trackingId = extractTrackingId(response);
      await upsertPostPlatform(env.DB, {
        post_id: post.id,
        platform: postedField,
        tracking_id: trackingId ? `UP:${trackingId}` : null,
        status: 'sent',
        idempotency_key: idemKey,
      });
      await logPostingAudit(env.DB, post.id, postedField, 'sent', `Publicación GBP enviada para ${loc.label}.`, response);
      stats.posted++;
    } catch (err) {
      if (err instanceof UploadPostError && err.isIdempotent) {
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform: postedField,
          tracking_id: `UP:IDEM:${idemKey}`,
          status: 'idempotent',
        });
        await logPostingAudit(env.DB, post.id, postedField, 'idempotent', `Upload-Post indicó que la publicación GBP de ${loc.label} ya existía.`, err.body);
        stats.posted++;
      } else {
        const rawMsg = err instanceof UploadPostError
          ? `HTTP ${err.status}: ${err.body.slice(0, 200)}`
          : String(err);
        const msg = translatePostingError(rawMsg, postedField);
        await upsertPostPlatform(env.DB, {
          post_id: post.id,
          platform: postedField,
          status: 'failed',
          error_message: msg,
        });
        await logPostingAudit(env.DB, post.id, postedField, 'failed', msg, rawMsg);
        stats.failed++;
      }
    }
  }
}

async function writeError(db: D1Database, postId: string, msg: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare('UPDATE posts SET error_log = ?, updated_at = ? WHERE id = ?')
    .bind(`[${new Date().toISOString()}] ${msg}`, now, postId)
    .run();
}

async function logPostingAudit(
  db: D1Database,
  postId: string,
  platform: string,
  status: string,
  messageEs: string,
  raw?: unknown,
): Promise<void> {
  await writeAuditLog(db, {
    action: `posting.${status}`,
    entity_type: 'post',
    entity_id: postId,
    new_value: {
      platform,
      message_es: messageEs,
      raw,
    },
  });
}
