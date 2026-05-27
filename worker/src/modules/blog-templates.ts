import type { ClientRow } from '../types';
import type { BusinessTemplateKey } from '../services/wordpress';

export interface BlogTemplateConfig {
  key: BusinessTemplateKey;
  clientSlug?: string;
  label: string;
  industryLabel: string;
  audience: string;
  tone: string;
  authorLabel: string;
  categoryLabel: string;
  primaryColor?: string;
  accentColor?: string;
  quickFacts: string[];
  relatedServices: string[];
  shareTitle: string;
}

const CLIENT_BLOG_TEMPLATES: Record<string, Omit<BlogTemplateConfig, 'clientSlug'>> = {
  '247-lockout-pasadena': {
    key: 'locksmith',
    label: 'Emergency Locksmith Desk',
    industryLabel: 'Locksmith',
    audience: 'homeowners, renters, drivers, and property managers who need fast access help',
    tone: 'direct, reassuring, local, urgent without panic',
    authorLabel: '24/7 Lockout Locksmith Team',
    categoryLabel: 'Security and Access',
    primaryColor: '#1c2242',
    accentColor: '#f4b400',
    quickFacts: ['Emergency access', 'Residential locks', 'Smart lock setup'],
    relatedServices: ['Emergency locksmith service', 'Door lock hardware', 'Security door locks'],
    shareTitle: 'Local locksmith guide',
  },
  '724-locksmith-ca': {
    key: 'locksmith',
    label: 'Access and Security Guide',
    industryLabel: 'Locksmith',
    audience: 'California homeowners and small business owners upgrading lock access',
    tone: 'practical, clear, security-first',
    authorLabel: '7/24 Locksmith Services Team',
    categoryLabel: 'Locksmith Planning',
    primaryColor: '#1a73e8',
    accentColor: '#fbbc04',
    quickFacts: ['Smart locks', 'Keyless entry', 'Hardware installation'],
    relatedServices: ['Smart Lock Installation & Setup', 'Keyless Entry System Installation', 'Lock rekeying'],
    shareTitle: 'Smart security guide',
  },
  'americas-professional-builders': {
    key: 'builders-remodeling',
    label: 'Builder Field Notes',
    industryLabel: 'Construction',
    audience: 'Los Angeles homeowners comparing repairs, rebuilds, and exterior improvements',
    tone: 'experienced, steady, contractor-led',
    authorLabel: 'America’s Professional Builders Inc',
    categoryLabel: 'Construction Guidance',
    primaryColor: '#1e3a5f',
    accentColor: '#c8a04a',
    quickFacts: ['Licensed planning', 'Roofing and exterior work', 'Project coordination'],
    relatedServices: ['Roofing', 'Construction', 'Exterior repairs'],
    shareTitle: 'Construction planning article',
  },
  'caliview-builders': {
    key: 'builders-remodeling',
    label: 'Cali-View Remodeling Journal',
    industryLabel: 'Construction',
    audience: 'Southern California homeowners planning remodels and additions',
    tone: 'polished, helpful, design-aware',
    authorLabel: 'CALI-VIEW BUILDERS',
    categoryLabel: 'Remodeling Strategy',
    primaryColor: '#1a3c6e',
    accentColor: '#f59e0b',
    quickFacts: ['Major renovations', 'Kitchen and bath planning', 'Local project sequencing'],
    relatedServices: ['Major Renovations', 'Kitchen Remodeling', 'Bathroom Remodeling'],
    shareTitle: 'Remodeling planning guide',
  },
  'caliview-landscape': {
    key: 'landscaping',
    label: 'Landscape Design Notebook',
    industryLabel: 'Landscaping',
    audience: 'homeowners who want durable curb appeal and water-wise outdoor spaces',
    tone: 'calm, visual, practical, climate-aware',
    authorLabel: 'Caliview Landscape',
    categoryLabel: 'Landscape Planning',
    primaryColor: '#2f6b3f',
    accentColor: '#d7a84f',
    quickFacts: ['Planting zones', 'Irrigation planning', 'Outdoor maintenance'],
    relatedServices: ['Landscape Design', 'Drought tolerant gardens', 'Outdoor planning'],
    shareTitle: 'Landscape design guide',
  },
  'daniels-locksmith': {
    key: 'locksmith',
    label: 'Lock and Key Dispatch',
    industryLabel: 'Locksmith',
    audience: 'Burbank-area residents and commercial property contacts',
    tone: 'plainspoken, fast, trustworthy',
    authorLabel: "Daniel's Locks & Key",
    categoryLabel: 'Locksmith Advice',
    primaryColor: '#1a73e8',
    accentColor: '#fbbc04',
    quickFacts: ['Lock rekeying', 'Building lockouts', 'Hardware repair'],
    relatedServices: ['Lock rekeying', 'Building lockouts', 'Door lock repair'],
    shareTitle: 'Locksmith service guide',
  },
  'elite-team-builders': {
    key: 'builders-remodeling',
    label: 'Elite Remodeling Review',
    industryLabel: 'Construction',
    audience: 'homeowners in California, Oregon, and Washington planning higher-end remodels',
    tone: 'premium, editorial, design-forward, practical',
    authorLabel: 'Elite Team Builders Inc.',
    categoryLabel: 'Remodeling Insight',
    primaryColor: '#1a1a2e',
    accentColor: '#c8a04a',
    quickFacts: ['CA / OR / WA service areas', 'Kitchen and bath remodels', 'Design-build guidance'],
    relatedServices: ['Kitchen Remodeling', 'Bathroom Remodeling', 'Electrical & Plumbing'],
    shareTitle: 'Luxury remodeling guide',
  },
  'golden-touch-roofing': {
    key: 'roofing',
    label: 'Roofing Maintenance Brief',
    industryLabel: 'Roofing',
    audience: 'property owners who want to prevent leaks and extend roof life',
    tone: 'protective, practical, inspection-focused',
    authorLabel: 'Golden Touch Roofing',
    categoryLabel: 'Roofing Guidance',
    primaryColor: '#a76519',
    accentColor: '#f4c542',
    quickFacts: ['Leak prevention', 'Roof inspections', 'Repair timing'],
    relatedServices: ['Roof Maintenance', 'Roof Repairing', 'Roof inspections'],
    shareTitle: 'Roofing maintenance article',
  },
  'jaz-makeup-artist': {
    key: 'beauty',
    label: 'Beauty Prep Column',
    industryLabel: 'Makeup',
    audience: 'clients preparing for events, photos, weddings, and special occasions',
    tone: 'warm, polished, confidence-building',
    authorLabel: 'Jaz MakeUp Artist',
    categoryLabel: 'Beauty Preparation',
    primaryColor: '#9d3f63',
    accentColor: '#f2c7d5',
    quickFacts: ['Skin prep', 'Event timing', 'Touch-up planning'],
    relatedServices: ['Makeup', 'Event makeup', 'Beauty consultation'],
    shareTitle: 'Makeup preparation guide',
  },
  'modern-vision-remodeling': {
    key: 'builders-remodeling',
    label: 'Modern Remodeling Ledger',
    industryLabel: 'Remodeling',
    audience: 'Texas homeowners planning practical, modern remodels',
    tone: 'modern, straightforward, project-focused',
    authorLabel: 'Modern Vision Remodeling Experts',
    categoryLabel: 'Remodeling Planning',
    primaryColor: '#243447',
    accentColor: '#6bbf8f',
    quickFacts: ['Modern finishes', 'Scope planning', 'Texas remodels'],
    relatedServices: ['Remodeling', 'Kitchen updates', 'Bathroom updates'],
    shareTitle: 'Modern remodeling guide',
  },
  'unlocked-pros': {
    key: 'locksmith',
    label: 'Unlocked Security Notes',
    industryLabel: 'Locksmith',
    audience: 'homeowners and renters balancing convenience with better home security',
    tone: 'friendly, confident, security-aware',
    authorLabel: 'Unlock´D Pros',
    categoryLabel: 'Residential Security',
    primaryColor: '#1a73e8',
    accentColor: '#34a853',
    quickFacts: ['Residential lockouts', 'Rekeying', 'Security upgrades'],
    relatedServices: ['Emergency Locksmith Services', 'Lock rekeying', 'Security door locks'],
    shareTitle: 'Residential locksmith guide',
  },
  webxni: {
    key: 'agency-marketing',
    label: 'Growth Strategy Review',
    industryLabel: 'Marketing',
    audience: 'service business owners who need clearer visibility and lead flow',
    tone: 'strategic, concise, operator-friendly',
    authorLabel: 'WebXni',
    categoryLabel: 'Marketing Strategy',
    primaryColor: '#1a73e8',
    accentColor: '#34a853',
    quickFacts: ['Local SEO', 'Content systems', 'Lead generation'],
    relatedServices: ['Search Engine Optimization (SEO)', 'Marketing automation', 'Content strategy'],
    shareTitle: 'Marketing strategy article',
  },
};

function parseBrandJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolveBlogTemplateConfig(client: Pick<ClientRow,
  'slug' | 'canonical_name' | 'industry' | 'state' | 'brand_json' | 'wp_template_key' | 'cta_text'
> & { brand_primary_color?: string | null }): BlogTemplateConfig {
  const brand = parseBrandJson(client.brand_json);
  const base = CLIENT_BLOG_TEMPLATES[client.slug] ?? {
    key: inferTemplateKeyFromClient(client),
    label: `${client.canonical_name} Editorial Guide`,
    industryLabel: client.industry ?? 'Professional Service',
    audience: 'local customers comparing service options and next steps',
    tone: 'professional, clear, practical',
    authorLabel: client.canonical_name,
    categoryLabel: client.industry ?? 'Service Guide',
    quickFacts: [client.industry ?? 'Service planning', client.state ?? 'Local guidance', 'Next steps'],
    relatedServices: [client.industry ?? 'Professional services'],
    shareTitle: 'Service planning article',
  };

  return {
    ...base,
    clientSlug: client.slug,
    primaryColor: client.brand_primary_color?.trim()
      || stringValue(brand.primary_color)
      || stringValue(brand.primaryColor)
      || base.primaryColor,
    accentColor: stringValue(brand.accent_color)
      || stringValue(brand.accentColor)
      || base.accentColor,
    authorLabel: stringValue(brand.company_name) || base.authorLabel,
  };
}

function inferTemplateKeyFromClient(client: Pick<ClientRow, 'wp_template_key' | 'industry'>): BusinessTemplateKey {
  const raw = `${client.wp_template_key ?? ''} ${client.industry ?? ''}`.toLowerCase();
  if (/landscap|garden|outdoor|lawn/.test(raw)) return 'landscaping';
  if (/makeup|beauty|cosmetic|artist/.test(raw)) return 'beauty';
  if (/builder|remodel|renovat|construction|kitchen|bathroom/.test(raw)) return 'builders-remodeling';
  if (/roof/.test(raw)) return 'roofing';
  if (/locksmith|lock|key/.test(raw)) return 'locksmith';
  if (/account|tax|bookkeep|cpa|finance/.test(raw)) return 'accounting';
  if (/agency|marketing|seo|advertis|branding/.test(raw)) return 'agency-marketing';
  return 'generic-service';
}

export function getConfiguredActiveClientTemplateSlugs(): string[] {
  return Object.keys(CLIENT_BLOG_TEMPLATES).sort();
}
