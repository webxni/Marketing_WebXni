import type { PostRow } from '../types';
import { approveContentReview, getLatestContentReview } from '../db/queries';
import { buildPostContentHash } from './content-review';
import { isGovernedLocksmith, validateLocksmithGeneratedContent } from './editorial-governance';
import { normalizeContentType } from './platform-compatibility';
import { type ReadinessClient, type ReadinessIssue, validateAutomationReadiness } from './readiness-gate';

export interface ApprovalReadinessResult {
  blockers: ReadinessIssue[];
  cleanReviewId: string | null;
}

function reviewHasFindings(notesJson: string): boolean {
  try {
    const notes = JSON.parse(notesJson) as { findings?: unknown; issues?: unknown };
    return (Array.isArray(notes.findings) && notes.findings.length > 0)
      || (Array.isArray(notes.issues) && notes.issues.length > 0);
  } catch {
    return true;
  }
}

/**
 * Authoritative approval gate. This intentionally includes database-backed
 * editorial and delivery state that cannot be inferred safely in the browser.
 */
export async function validatePostApprovalReadiness(
  db: D1Database,
  post: PostRow,
  client: ReadinessClient,
  options: { now?: Date } = {},
): Promise<ApprovalReadinessResult> {
  const blockers: ReadinessIssue[] = [];
  const baseIssue = validateAutomationReadiness(post, client, { mode: 'ready', now: options.now });
  if (baseIssue) blockers.push(baseIssue);

  const automated = post.scheduled_by_automation === 1;
  const contentType = normalizeContentType(post.content_type, post.asset_type);
  const mediaRequired = contentType !== 'blog' && contentType !== 'text';
  if (automated && !post.generation_run_id && !post.created_by) {
    blockers.push({
      code: 'GENERATION_PROVENANCE_REQUIRED',
      message: 'Automated draft is missing its generation run or creating agent provenance',
    });
  }
  if (automated && mediaRequired && post.asset_r2_key && !post.asset_source?.trim()) {
    blockers.push({ code: 'ASSET_SOURCE_REQUIRED', message: 'Media source is missing' });
  }
  let cleanReviewId: string | null = null;
  if (automated) {
    const review = await getLatestContentReview(db, post.id);
    const currentHash = await buildPostContentHash(post);
    if (!review || review.content_hash !== currentHash) {
      blockers.push({
        code: 'EDITORIAL_REVIEW_REQUIRED',
        message: 'The current content version does not have an editorial review',
      });
    } else if (
      review.disposition !== 'reviewed'
      || ['high', 'blocker', 'critical'].includes(review.severity)
      || reviewHasFindings(review.notes_json)
    ) {
      blockers.push({
        code: 'EDITORIAL_REVIEW_BLOCKED',
        message: `Editorial review is unresolved (${review.severity}/${review.disposition})`,
      });
    } else {
      cleanReviewId = review.id;
    }
  }

  if (isGovernedLocksmith(client)) {
    const governanceIssues = await validateLocksmithGeneratedContent(db, client, post);
    for (const issue of governanceIssues) {
      blockers.push({ code: 'EDITORIAL_POLICY_BLOCKED', message: issue });
    }
  }

  const blockedPlatform = await db.prepare(
    `SELECT platform, error_message
     FROM post_platforms
     WHERE post_id = ? AND status IN ('blocked', 'failed')
     ORDER BY platform
     LIMIT 1`,
  ).bind(post.id).first<{ platform: string; error_message: string | null }>();
  if (blockedPlatform) {
    blockers.push({
      code: 'PLATFORM_DELIVERY_BLOCKED',
      message: `${blockedPlatform.platform}: ${blockedPlatform.error_message ?? 'delivery is blocked'}`,
    });
  }

  return { blockers, cleanReviewId };
}

export async function approveCleanEditorialReview(
  db: D1Database,
  reviewId: string | null,
  reviewedBy: string,
): Promise<void> {
  if (reviewId) await approveContentReview(db, reviewId, reviewedBy);
}
