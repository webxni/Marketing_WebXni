import { describe, expect, it } from 'vitest';
import { AGENCY_AI_MEDIA_RIGHTS_NOTE, normalizePrimaryAssetSource } from './assets';

describe('asset source normalization', () => {
  it('records authenticated direct uploads under the agency AI-media policy', () => {
    expect(normalizePrimaryAssetSource('upload')).toBe('ai_generated');
    expect(normalizePrimaryAssetSource('designer')).toBe('ai_generated');
    expect(normalizePrimaryAssetSource(null)).toBe('ai_generated');
  });

  it('preserves explicit generated and licensed source classes', () => {
    expect(normalizePrimaryAssetSource('ai_generated')).toBe('ai_generated');
    expect(normalizePrimaryAssetSource('licensed_stock')).toBe('licensed_stock');
  });

  it('records the agency AI-media policy for uploaded assets', () => {
    expect(AGENCY_AI_MEDIA_RIGHTS_NOTE).toContain('WebXni assumes responsibility');
  });
});

