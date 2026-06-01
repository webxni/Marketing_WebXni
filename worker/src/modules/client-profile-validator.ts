/**
 * Client Profile Validation
 *
 * Strict validation of generated content against client business profile.
 * Blocks content that doesn't match client's industry, services, or package.
 *
 * This prevents critical errors like Unlock´D Pros (locksmith) receiving
 * remodeling/construction content.
 */

import type { ClientRow, GeneratedPost } from '../types';

export interface ClientProfileValidationRules {
  client_id: string;
  industry_strict_mode: number;
  allowed_service_categories: string | null;
  forbidden_service_categories: string | null;
  allowed_content_types: string | null;
  forbidden_content_types: string | null;
  forbidden_topics: string | null;
  allowed_package_limit_monthly: number | null;
  require_geographic_mention: number;
  require_service_mention: number;
}

export interface ValidationResult {
  valid: boolean;
  blockedReason?: string;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Industry-specific validation rules
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_FORBIDDEN_KEYWORDS: Record<string, string[]> = {
  locksmith: [
    'remodel', 'renovation', 'kitchen', 'bathroom', 'bath',
    'construction', 'build', 'contractor', 'floor', 'carpet',
    'tile', 'countertop', 'cabinet', 'appliance', 'painting',
    'drywall', 'hvac', 'plumbing', 'electrical', 'adu',
    'addition', 'extension', 'home improvement'
  ],
  roofing: [
    'kitchen', 'bathroom', 'remodel', 'renovation', 'interior',
    'flooring', 'carpet', 'appliance', 'cabinet', 'countertop',
    'locksmith', 'plumbing'
  ],
  remodeling: [
    'locksmith', 'roofing', 'tree service', 'plumbing emergency',
    'lock repair', 'roof repair'
  ],
  locksmith_residential: [
    'commercial', 'enterprise', 'corporate'
  ],
  locksmith_commercial: [
    'residential'
  ],
};

const INDUSTRY_REQUIRED_KEYWORDS: Record<string, string[][]> = {
  // Each row is an OR group; all groups must have at least one match
  locksmith: [
    ['lock', 'locksmith', 'unlock', 'key'],
    ['security', 'access', 'lockout', 'rekey']
  ],
  roofing: [
    ['roof', 'roofing', 'shingle', 'gutter'],
    ['leak', 'damage', 'inspection', 'repair']
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

export function validateContentAgainstClientProfile(
  post: GeneratedPost,
  client: ClientRow,
  rules: ClientProfileValidationRules | null,
  services: { name: string }[] = [],
): ValidationResult {
  const warnings: string[] = [];

  if (!rules || !rules.industry_strict_mode) {
    // Soft mode — only warnings
    return { valid: true, warnings };
  }

  // ── Hard Block: Industry mismatch ────────────────────────────────────────
  const industry = (client.industry ?? '').toLowerCase();
  const title = (post.title ?? '').toLowerCase();
  const caption = (post.master_caption ?? '').toLowerCase();
  const combined = `${title} ${caption}`.toLowerCase();

  if (industry && INDUSTRY_FORBIDDEN_KEYWORDS[industry]) {
    const forbidden = INDUSTRY_FORBIDDEN_KEYWORDS[industry];
    for (const keyword of forbidden) {
      if (combined.includes(keyword)) {
        return {
          valid: false,
          blockedReason: `Industry mismatch: "${keyword}" in ${industry} client content (title: "${post.title?.slice(0, 60)}")`,
          warnings: [],
        };
      }
    }
  }

  if (industry && INDUSTRY_REQUIRED_KEYWORDS[industry]) {
    const requiredGroups = INDUSTRY_REQUIRED_KEYWORDS[industry];
    const anyGroupMissing = requiredGroups.some(
      (group) => !group.some((keyword) => combined.includes(keyword))
    );
    if (anyGroupMissing) {
      warnings.push(
        `Industry validation: ${industry} content may lack required keywords (${requiredGroups.map((g) => g.join(' or ')).join(' AND ')})`
      );
    }
  }

  // ── Hard Block: Service validation ────────────────────────────────────────
  if (rules.require_service_mention && services.length > 0) {
    const allowedServices = services
      .filter((s) => s.name)
      .map((s) => s.name.toLowerCase());
    const captionWords = caption.split(/\s+/);
    const hasServiceMention = allowedServices.some((service) =>
      captionWords.some((word) => word.includes(service.slice(0, 4)))
    );

    if (!hasServiceMention) {
      warnings.push(
        `Content mentions no services from client's profile (${allowedServices.slice(0, 3).join(', ')})`
      );
    }
  }

  // ── Hard Block: Forbidden topics ─────────────────────────────────────────
  if (rules.forbidden_topics) {
    try {
      const forbidden = JSON.parse(rules.forbidden_topics) as string[];
      for (const topic of forbidden) {
        if (combined.includes(topic.toLowerCase())) {
          return {
            valid: false,
            blockedReason: `Forbidden topic "${topic}" appears in content for client`,
            warnings: [],
          };
        }
      }
    } catch {
      /* invalid JSON, skip */
    }
  }

  // ── Soft: Content type validation ────────────────────────────────────────
  if (rules.allowed_content_types) {
    try {
      const allowed = JSON.parse(rules.allowed_content_types) as string[];
      if (!allowed.includes(post.content_type || 'image')) {
        warnings.push(
          `Content type "${post.content_type}" not in allowed types for client: ${allowed.join(', ')}`
        );
      }
    } catch {
      /* invalid JSON, skip */
    }
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Normalize forbidden keywords from content for strict matching.
 * Prevents smart quotes, accents, and case from bypassing validation.
 */
export function normalizeForbiddenKeywordCheck(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // remove diacritics
    .replace(/['']/g, '') // normalize apostrophes
    .replace(/[""]/g, '') // normalize quotes
    .trim();
}

/**
 * Detect if content topic matches or conflicts with client industry.
 */
export function detectIndustryMismatch(
  generatedTopic: string,
  clientIndustry: string | null,
): { mismatch: boolean; reason?: string } {
  if (!clientIndustry) return { mismatch: false };

  const industry = clientIndustry.toLowerCase();
  const topic = normalizeForbiddenKeywordCheck(generatedTopic);

  // Quick check against forbidden keywords
  if (INDUSTRY_FORBIDDEN_KEYWORDS[industry]) {
    for (const keyword of INDUSTRY_FORBIDDEN_KEYWORDS[industry]) {
      if (topic.includes(keyword)) {
        return {
          mismatch: true,
          reason: `${industry} client received content about "${keyword}"`,
        };
      }
    }
  }

  return { mismatch: false };
}
