import { describe, expect, it } from 'vitest';
import {
  buildGenerationRequest,
  canonicalizeGeneratedPhoneNumbers,
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

  it('uses the documented horizontal format for multi-platform images', () => {
    const prompt = buildGenerationRequest(socialContext).prompt;
    expect(prompt).toContain('1200x628');
    expect(prompt).toContain('immediate help');
  });

  it('rejects a designer prompt with the wrong asset dimensions', () => {
    const quality = validateGeneratedContent({
      title: 'How Rekeying Changes Access After a Hollywood Move',
      master_caption: 'A residential locksmith Hollywood homeowners call can rekey a home so old keys no longer control access.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
      ai_image_prompt: 'Crear una imagen cuadrada de 1080x1080 para redes sociales.',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings).toContain('designer prompt must specify 1200x628 for image');
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

  it('canonicalizes generated phone numbers to the verified client phone', () => {
    const post = {
      title: 'Hollywood Rekeying',
      master_caption: 'Call 818-555-0199 to discuss residential rekeying in Hollywood.',
      ai_image_prompt: 'Texto: 818.555.0199',
    };
    canonicalizeGeneratedPhoneNumbers(post, '(323) 555-0100');
    expect(post.master_caption).toContain('(323) 555-0100');
    expect(post.ai_image_prompt).toContain('(323) 555-0100');
  });

  it('rejects unverified licensing and generic expert-answer copy', () => {
    const quality = validateGeneratedContent({
      title: 'Pasadena Rekeying: Expert Answers',
      master_caption: 'Our licensed professionals provide expert guidance for residential rekeying in Hollywood.',
      target_keyword: 'residential locksmith Hollywood',
      target_locality: 'Hollywood',
    }, socialContext);
    expect(quality.passed).toBe(false);
    expect(quality.warnings).toContain('unsupported claim: license');
    expect(quality.warnings.some((warning) => warning.includes('expert answers'))).toBe(true);
  });
});
