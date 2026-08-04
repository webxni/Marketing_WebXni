import { describe, expect, it } from 'vitest';
import {
  buildGenerationRequest,
  isGeneratedCaptionField,
  normalizeGeneratedCaptionValue,
  validateGeneratedContent,
  type GenerationContext,
} from './openai';

const socialContext: GenerationContext = {
  client: { canonical_name: 'Daniel\'s Locks & Key', industry: 'Locksmith', state: 'CA', phone: '(323) 555-0100' },
  intelligence: null,
  recentTitles: [],
  feedback: [],
  publishDate: '2026-08-05',
  contentType: 'image',
  platforms: ['facebook', 'instagram'],
  serviceAreas: ['Hollywood'],
  serviceNames: ['Residential Rekeying'],
  targetKeywords: ['residential locksmith Hollywood'],
  topicResearch: {
    topic: 'How residential rekeying changes access after a move',
    angle: 'Explain the practical access-control decision.',
    format: 'process_breakdown',
    targetKeyword: 'residential locksmith Hollywood',
    localModifier: 'Hollywood',
    searchQuestion: 'How does residential rekeying work after moving in Hollywood?',
  },
  highQuality: true,
};

describe('generated caption normalization', () => {
  it('keeps plain captions unchanged after trimming', () => {
    expect(normalizeGeneratedCaptionValue('  Call today for a free estimate.  ')).toBe('Call today for a free estimate.');
  });

  it('extracts public copy from structured caption JSON strings', () => {
    const raw = JSON.stringify({
      post_type: 'STANDARD',
      body: 'Pasadena homeowners can refresh outdoor spaces with expert hardscape planning.',
      cta_type: 'CALL',
      designer_prompt_es: 'Crear una imagen horizontal de un patio moderno.',
    });

    expect(normalizeGeneratedCaptionValue(raw)).toBe(
      'Pasadena homeowners can refresh outdoor spaces with expert hardscape planning.',
    );
  });

  it('extracts public copy from structured caption objects', () => {
    expect(normalizeGeneratedCaptionValue({
      caption: 'Protect your remodel timeline with early permit planning.',
      review_notes: 'Public copy is in caption.',
    })).toBe('Protect your remodel timeline with early permit planning.');
  });

  it('recognizes all persisted social caption fields', () => {
    expect(isGeneratedCaptionField('cap_gbp_la')).toBe(true);
    expect(isGeneratedCaptionField('cap_google_business')).toBe(true);
    expect(isGeneratedCaptionField('ai_image_prompt')).toBe(false);
  });

  it('requires SEO keyword and locality metadata for social generation', () => {
    const schema = buildGenerationRequest(socialContext).schema.schema as { required: string[] };
    expect(schema.required).toContain('target_keyword');
    expect(schema.required).toContain('target_locality');
  });

  it('rejects recycled titles and missing exact SEO metadata', () => {
    const quality = validateGeneratedContent({
      title: 'Before You Hire a Residential Locksmith',
      master_caption: 'Hollywood residents can use residential rekeying to control who has keys after a move.',
      target_keyword: 'residential locksmith',
      target_locality: 'Los Angeles',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.startsWith('generic pattern:'))).toBe(true);
    expect(quality.warnings).toContain('target_keyword must exactly match selected keyword: "residential locksmith Hollywood"');
    expect(quality.warnings).toContain('target_locality must exactly match one confirmed area: Hollywood');
  });

  it('rejects generic authority claims in titles', () => {
    const quality = validateGeneratedContent({
      title: 'Trusted Residential Locksmith in Hollywood',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access after a move.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.includes('^trusted'))).toBe(true);
  });

  it('rejects leading numbered detail-list titles', () => {
    const quality = validateGeneratedContent({
      title: '3 Details That Decide Your Hollywood Rekey Plan',
      master_caption: 'A residential locksmith Hollywood homeowners call can explain how rekeying changes access after a move.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings.some((warning) => warning.includes('details|checks|questions|things|tips'))).toBe(true);
  });
});
