export interface KeywordCandidate {
  keyword: string;
  kw_type?: string;
  locality?: string | null;
  source?: string | null;
  confidence?: string | null;
}

export interface KeywordProfile {
  industry: string | null;
  state: string | null;
  services: string[];
  serviceAreas: string[];
}

export interface KeywordClassification {
  status: 'active' | 'proposed';
  reason: string | null;
}

const GENERIC_TOKENS = new Set([
  'about', 'best', 'building', 'business', 'company', 'general', 'help', 'home',
  'installation', 'local', 'near', 'professional', 'repair', 'service', 'services',
  'solutions', 'team', 'your',
]);

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function meaningfulTokens(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => normalize(value).split(/\s+/)))]
    .filter((token) => token.length >= 4 && !GENERIC_TOKENS.has(token));
}

export function classifyKeywordCandidate(
  candidate: KeywordCandidate,
  profile: KeywordProfile,
): KeywordClassification {
  if (candidate.source === 'manual') return { status: 'active', reason: null };
  if (candidate.confidence === 'low') return { status: 'proposed', reason: 'low_confidence' };
  if (profile.services.length === 0) return { status: 'proposed', reason: 'missing_service_profile' };

  const keyword = normalize(candidate.keyword);
  const type = String(candidate.kw_type ?? 'secondary').toLowerCase();
  const serviceTokens = meaningfulTokens([profile.industry ?? '', ...profile.services]);
  const serviceMatch = serviceTokens.some((token) => keyword.includes(token));
  if (!serviceMatch) return { status: 'proposed', reason: 'outside_confirmed_services' };

  if (type === 'local') {
    if (profile.serviceAreas.length === 0) return { status: 'proposed', reason: 'missing_service_areas' };
    const areaMatch = profile.serviceAreas.some((area) => keyword.includes(normalize(area)));
    if (!areaMatch) return { status: 'proposed', reason: 'outside_confirmed_service_areas' };
  }

  if (type === 'near_me' && !/\bnear me\b/.test(keyword)) {
    return { status: 'proposed', reason: 'invalid_near_me_intent' };
  }

  return { status: 'active', reason: null };
}
