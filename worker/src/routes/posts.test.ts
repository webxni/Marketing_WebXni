import { describe, expect, it } from 'vitest';
import { generatedCaptionQualityIssue } from './posts';

describe('generatedCaptionQualityIssue', () => {
  it('accepts a grounded Pinterest caption beginning with the exact keyword', () => {
    expect(generatedCaptionQualityIssue(
      'pinterest',
      'Social media management near me: check cadence and platform-specific formats first.',
      'social media management near me',
      [],
    )).toBeNull();
  });

  it('rejects generic hashtags and missing Pinterest keywords', () => {
    expect(generatedCaptionQualityIssue(
      'pinterest',
      'Social media management near me: compare posting cadence. #marketing',
      'social media management near me',
      [],
    )).toBe('used a generic Pinterest hashtag');
    expect(generatedCaptionQualityIssue(
      'pinterest',
      'Compare posting cadence before changing your content plan.',
      'social media management near me',
      [],
    )).toBe('does not begin with the exact target keyword');
  });

  it('rejects unsupported outcome claims and client restrictions', () => {
    expect(generatedCaptionQualityIssue('facebook', 'Fix your reach with a better schedule.', null, [])).toBe(
      'made an unsupported outcome claim',
    );
    expect(generatedCaptionQualityIssue('facebook', 'Ask about key fob programming.', null, ['Never mention car key fob'])).toBe(
      'violated a client restriction: key fob',
    );
  });
});
