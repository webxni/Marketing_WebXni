import { describe, expect, it } from 'vitest';
import { normalizePrimaryAssetSource } from './assets';

describe('asset source normalization', () => {
  it('records authenticated direct uploads as designer media', () => {
    expect(normalizePrimaryAssetSource('upload')).toBe('designer');
    expect(normalizePrimaryAssetSource(null)).toBe('designer');
  });

  it('preserves explicit generated and licensed source classes', () => {
    expect(normalizePrimaryAssetSource('ai_generated')).toBe('ai_generated');
    expect(normalizePrimaryAssetSource('licensed_stock')).toBe('licensed_stock');
  });
});

