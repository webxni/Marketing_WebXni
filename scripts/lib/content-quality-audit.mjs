const PLATFORM_CAPTION_FIELD = {
  facebook: 'cap_facebook',
  instagram: 'cap_instagram',
  linkedin: 'cap_linkedin',
  x: 'cap_x',
  threads: 'cap_threads',
  tiktok: 'cap_tiktok',
  pinterest: 'cap_pinterest',
  bluesky: 'cap_bluesky',
  google_business: 'cap_google_business',
  youtube: 'youtube_title',
  website_blog: 'blog_excerpt',
};

const GENERIC_MARKETING_RE = /\b(?:ready to|transform|elevate|unlock|discover|game.?changer|boost|optimize your|stunning|dreaming of|stress-free)\b/i;
const OVERSTRONG_CLAIM_RE = /\b(?:guarantee|guaranteed|no surprises|hidden fees|prevent(?:s|ing)?\b|ensure(?:s)?\b|stay pristine for decades|saves you money|costly repairs|lasting value)\b/i;
const PHONE_RE = /\(?(\d{3})\)?[-. ]?(\d{3})[-. ]?(\d{4})/g;
const RECYCLED_COPY_RE = /\b(?:trusted (?:team|experts?)|expert (?:team|touch|craftsmanship)|highest satisfaction|ideal space|home makeover|peace of mind|look no further|top-notch|exceptional service|your go-to)\b/i;

function parsePlatforms(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectText(post) {
  return [
    post.title,
    post.master_caption,
    post.cap_facebook,
    post.cap_instagram,
    post.cap_linkedin,
    post.cap_x,
    post.cap_threads,
    post.cap_tiktok,
    post.cap_pinterest,
    post.cap_bluesky,
    post.cap_google_business,
    post.youtube_title,
    post.youtube_description,
    post.blog_excerpt,
    post.meta_description,
    post.ai_image_prompt,
    post.ai_video_prompt,
    post.video_script,
  ].filter(Boolean).join('\n');
}

export function auditGeneratedDraftContent(draft) {
  const hasPlatformCaptions = Boolean(draft?.platform_captions && typeof draft.platform_captions === 'object');
  const platformCaptions = hasPlatformCaptions
    ? Object.values(draft.platform_captions)
    : [];
  const combined = [
    draft?.title,
    draft?.master_caption,
    draft?.body,
    draft?.excerpt,
    draft?.designer_prompt_es,
    draft?.ai_image_prompt,
    draft?.ai_video_prompt,
    ...platformCaptions,
  ].filter(Boolean).join('\n');
  const issues = [];
  if (GENERIC_MARKETING_RE.test(combined) || RECYCLED_COPY_RE.test(combined)) {
    issues.push({ code: 'GENERIC_MARKETING_LANGUAGE', severity: 'blocker' });
  }
  if (OVERSTRONG_CLAIM_RE.test(combined)) {
    issues.push({ code: 'UNSUPPORTED_OR_OVERSTRONG_OUTCOME_CLAIM', severity: 'blocker' });
  }
  const facebook = typeof draft?.platform_captions?.facebook === 'string' ? draft.platform_captions.facebook.trim() : '';
  const instagram = typeof draft?.platform_captions?.instagram === 'string' ? draft.platform_captions.instagram.trim() : '';
  if (hasPlatformCaptions && (!facebook || !instagram)) {
    issues.push({ code: 'MISSING_CORE_PLATFORM_ADAPTATIONS', severity: 'blocker' });
  } else if (hasPlatformCaptions && facebook.toLowerCase() === instagram.toLowerCase()) {
    issues.push({ code: 'IDENTICAL_CORE_PLATFORM_COPY', severity: 'blocker' });
  }
  return issues;
}

function titleFamily(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['your', 'the', 'for', 'and', 'with', 'what', 'how', 'in', 'of', 'to', 'a', 'an'].includes(word))
    .slice(0, 5)
    .join(' ');
}

export function auditPostContentQuality(post) {
  const platforms = parsePlatforms(post.platforms);
  const issues = [];
  const missing = [];

  for (const platform of platforms) {
    if (platform === 'youtube') {
      if (!nonEmpty(post.youtube_title) || !nonEmpty(post.youtube_description)) missing.push('youtube_title/description');
      continue;
    }
    if (platform === 'website_blog') {
      if (!nonEmpty(post.blog_content) || !nonEmpty(post.blog_excerpt) || !nonEmpty(post.seo_title) || !nonEmpty(post.meta_description) || !nonEmpty(post.slug)) missing.push('blog_fields');
      continue;
    }
    const field = PLATFORM_CAPTION_FIELD[platform];
    if (field && !nonEmpty(post[field])) missing.push(field);
  }

  if (missing.length > 0) {
    issues.push({ code: 'MISSING_PLATFORM_ADAPTATIONS', severity: 'blocker', fields: missing });
  }

  if (platforms.includes('google_business')) {
    if (!nonEmpty(post.cap_google_business)) {
      issues.push({ code: 'GBP_CAPTION_MISSING', severity: 'blocker' });
    }
    if (post.gbp_cta_type && post.gbp_cta_type !== 'CALL') {
      issues.push({ code: 'GBP_CTA_NEEDS_REVIEW', severity: 'warning', gbp_cta_type: post.gbp_cta_type });
    }
  }

  const combined = collectText(post);
  if (GENERIC_MARKETING_RE.test(combined)) {
    issues.push({ code: 'GENERIC_MARKETING_LANGUAGE', severity: 'warning' });
  }
  if (OVERSTRONG_CLAIM_RE.test(combined)) {
    issues.push({ code: 'UNSUPPORTED_OR_OVERSTRONG_OUTCOME_CLAIM', severity: 'warning' });
  }

  const phones = [...combined.matchAll(PHONE_RE)].map((match) => match[0]);
  const uniquePhones = [...new Set(phones)];
  if (uniquePhones.length > 1) {
    issues.push({ code: 'MULTIPLE_PHONE_NUMBERS', severity: 'blocker', phones: uniquePhones });
  }

  if (!post.asset_delivered || !post.asset_count || !post.asset_rights_confirmed) {
    issues.push({
      code: 'MEDIA_OR_RIGHTS_BLOCKER',
      severity: 'blocker',
      asset_delivered: Number(post.asset_delivered || 0),
      asset_count: Number(post.asset_count || 0),
      asset_rights_confirmed: Number(post.asset_rights_confirmed || 0),
    });
  }

  if (post.status !== 'ready' || !post.ready_for_automation) {
    issues.push({
      code: 'NOT_READY_FOR_AUTOMATION',
      severity: 'blocker',
      status: post.status || null,
      ready_for_automation: Number(post.ready_for_automation || 0),
    });
  }

  return {
    id: post.id,
    short_id: typeof post.id === 'string' ? post.id.slice(0, 12) : null,
    client: post.client_slug || post.client_name || post.client_id || null,
    title: post.title || null,
    status: post.status || null,
    type: post.content_type || null,
    date: post.publish_date || null,
    platforms,
    issue_count: issues.length,
    issues,
  };
}

export function auditPostsContentQuality(posts) {
  const rows = (posts || []).map(auditPostContentQuality);
  const families = new Map();
  for (const post of posts || []) {
    const family = titleFamily(post.title);
    if (!family) continue;
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(post.id);
  }
  const duplicateTitleFamilies = [...families.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([family, ids]) => ({ family, ids }));

  const issueCounts = {};
  for (const row of rows) {
    for (const issue of row.issues) issueCounts[issue.code] = (issueCounts[issue.code] || 0) + 1;
  }

  return {
    total: rows.length,
    posts_with_issues: rows.filter((row) => row.issue_count > 0).length,
    blocker_count: rows.reduce((sum, row) => sum + row.issues.filter((issue) => issue.severity === 'blocker').length, 0),
    warning_count: rows.reduce((sum, row) => sum + row.issues.filter((issue) => issue.severity === 'warning').length, 0),
    issue_counts: issueCounts,
    duplicate_title_families: duplicateTitleFamilies,
    rows,
  };
}
