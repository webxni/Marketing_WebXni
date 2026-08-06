import { describe, expect, it } from 'vitest';
import { buildPostContentHash, hasReviewAffectingUpdate, normalizeContentReviewFindings } from './content-review';

describe('content review versioning', () => {
  it('is stable for non-content metadata changes', async () => {
    const original = await buildPostContentHash({
      title: 'Rekeying a Pasadena home',
      master_caption: 'A practical rekeying guide for Pasadena homeowners.',
      target_keyword: 'lock rekeying Pasadena',
      status: 'draft',
    });
    const changedMetadata = await buildPostContentHash({
      title: 'Rekeying a Pasadena home',
      master_caption: 'A practical rekeying guide for Pasadena homeowners.',
      target_keyword: 'lock rekeying Pasadena',
      status: 'pending_approval',
      asset_delivered: 1,
    });

    expect(changedMetadata).toBe(original);
  });

  it('changes when reviewed content changes', async () => {
    const original = await buildPostContentHash({ title: 'Original', master_caption: 'First caption' });
    const edited = await buildPostContentHash({ title: 'Original', master_caption: 'Revised caption' });

    expect(edited).not.toBe(original);
    expect(hasReviewAffectingUpdate({ master_caption: 'Revised caption' })).toBe(true);
    expect(hasReviewAffectingUpdate({ status: 'pending_approval' })).toBe(false);
  });

  it('does not persist synthetic clean-pass findings', () => {
    const notes = normalizeContentReviewFindings({
      severity: 'info',
      findings: [
        { finding_type: 'clean_pass', severity: 'low' },
        { finding_type: 'designer_prompt_completeness', severity: 'low' },
      ],
    });

    expect(notes.findings).toEqual([
      { finding_type: 'designer_prompt_completeness', severity: 'low' },
    ]);
  });
});
