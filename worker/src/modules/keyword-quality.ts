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

const ALLOWED_INTENT_TOKENS = new Set([
  'apartment', 'automotive', 'booking', 'businesses', 'commercial', 'cost',
  'door', 'drivers', 'emergency', 'estimate', 'house', 'homeowner', 'homeowners',
  'mobile', 'office', 'property', 'replacement', 'residential', 'security',
  'vehicle',
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

function tokenStem(token: string): string {
  if (token.endsWith('ing') && token.length > 7) return token.slice(0, -3);
  if (token.endsWith('ers') && token.length > 7) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 6) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 5) return token.slice(0, -1);
  return token;
}

function normalizedTokenSet(values: string[]): Set<string> {
  return new Set(
    values
      .flatMap((value) => normalize(value).split(/\s+/))
      .filter(Boolean)
      .map(tokenStem),
  );
}

function matchesConfirmedService(keywordTokens: Set<string>, profile: KeywordProfile): boolean {
  const industryPhrases = [profile.industry ?? ''].filter(Boolean);
  const industryMatch = industryPhrases.some((phrase) => {
    const tokens = meaningfulTokens([phrase]).map(tokenStem);
    return tokens.length > 0 && tokens.some((token) => keywordTokens.has(token));
  });
  if (industryMatch) return true;

  return profile.services.some((service) => {
    const tokens = meaningfulTokens([service]).map(tokenStem);
    return tokens.length > 0 && tokens.every((token) => keywordTokens.has(token));
  });
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
  const keywordTokens = normalizedTokenSet([keyword]);
  const serviceMatch = matchesConfirmedService(keywordTokens, profile);
  if (!serviceMatch) return { status: 'proposed', reason: 'outside_confirmed_services' };

  if (type === 'local') {
    if (profile.serviceAreas.length === 0) return { status: 'proposed', reason: 'missing_service_areas' };
    const areaMatch = profile.serviceAreas.some((area) => keyword.includes(normalize(area)));
    if (!areaMatch) return { status: 'proposed', reason: 'outside_confirmed_service_areas' };
  }

  const confirmedTokens = normalizedTokenSet([
    profile.industry ?? '',
    profile.state ?? '',
    ...profile.services,
    ...profile.serviceAreas,
  ]);
  const unexpectedTokens = meaningfulTokens([keyword])
    .map(tokenStem)
    .filter((token) => !confirmedTokens.has(token) && !ALLOWED_INTENT_TOKENS.has(token));
  if (unexpectedTokens.length > 0) {
    return { status: 'proposed', reason: 'outside_confirmed_profile' };
  }

  if (type === 'near_me' && !/\bnear me\b/.test(keyword)) {
    return { status: 'proposed', reason: 'invalid_near_me_intent' };
  }

  return { status: 'active', reason: null };
}
