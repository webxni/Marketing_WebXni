import { describe, expect, it } from 'vitest';
import { weeklyGenerationPeriod } from './agency-scheduler';

describe('weeklyGenerationPeriod', () => {
  it('uses the Sunday through Saturday window on the Sunday cron', () => {
    expect(weeklyGenerationPeriod(new Date('2026-08-09T07:00:00Z'))).toEqual({
      period_start: '2026-08-09',
      period_end: '2026-08-15',
    });
  });

  it('anchors unexpected retry dates to the same UTC week', () => {
    expect(weeklyGenerationPeriod(new Date('2026-08-11T07:00:00Z'))).toEqual({
      period_start: '2026-08-09',
      period_end: '2026-08-15',
    });
  });
});
