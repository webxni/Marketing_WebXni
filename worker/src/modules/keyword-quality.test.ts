import { describe, expect, it } from 'vitest';
import { classifyKeywordCandidate, type KeywordProfile } from './keyword-quality';

const locksmithProfile: KeywordProfile = {
  industry: 'Locksmith',
  state: 'California',
  services: ['Residential Rekeying', 'Car Lockout'],
  serviceAreas: ['Pasadena', 'Altadena'],
};

describe('keyword candidate classification', () => {
  it('activates keywords grounded in a confirmed service and area', () => {
    expect(classifyKeywordCandidate({
      keyword: 'residential locksmith Pasadena',
      kw_type: 'local',
      source: 'research',
      confidence: 'high',
    }, locksmithProfile)).toEqual({ status: 'active', reason: null });
  });

  it('quarantines a local keyword outside confirmed service areas', () => {
    expect(classifyKeywordCandidate({
      keyword: 'residential locksmith Virginia Beach',
      kw_type: 'local',
      source: 'research',
      confidence: 'high',
    }, locksmithProfile)).toEqual({ status: 'proposed', reason: 'outside_confirmed_service_areas' });
  });

  it('quarantines unrelated and low-confidence research keywords', () => {
    expect(classifyKeywordCandidate({
      keyword: 'commercial roofing Pasadena',
      kw_type: 'local',
      source: 'research',
      confidence: 'high',
    }, locksmithProfile).status).toBe('proposed');
    expect(classifyKeywordCandidate({
      keyword: 'lock rekeying Pasadena',
      kw_type: 'local',
      source: 'research',
      confidence: 'low',
    }, locksmithProfile).reason).toBe('low_confidence');
  });

  it('preserves explicitly curated manual keywords', () => {
    expect(classifyKeywordCandidate({
      keyword: 'brand campaign phrase',
      source: 'manual',
      confidence: 'low',
    }, locksmithProfile)).toEqual({ status: 'active', reason: null });
  });
});
