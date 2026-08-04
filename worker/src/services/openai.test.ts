import { describe, expect, it } from 'vitest';
import {
  isGeneratedCaptionField,
  normalizeGeneratedCaptionValue,
} from './openai';

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
});
