import assert from 'node:assert/strict';
import { auditGeneratedDraftContent, auditPostContentQuality, auditPostsContentQuality } from './content-quality-audit.mjs';

let passed = 0;
const ok = (label, fn) => { fn(); passed++; console.log(`  ok  ${label}`); };

const basePost = {
  id: 'abc123456789',
  client_slug: 'example-client',
  title: 'Pasadena Lock Rekey Planning for Older Doors',
  status: 'ready',
  content_type: 'image',
  platforms: JSON.stringify(['facebook', 'instagram', 'google_business', 'youtube']),
  cap_facebook: 'Older Pasadena doors may need careful lock rekey planning after tenant turnover. Call (323) 346-7344.',
  cap_instagram: 'Older Pasadena doors may need careful lock rekey planning after tenant turnover. Call (323) 346-7344.',
  cap_google_business: 'Older Pasadena doors may need careful lock rekey planning after tenant turnover. Call (323) 346-7344.',
  youtube_title: 'Pasadena lock rekey planning for older doors',
  youtube_description: 'A practical look at lock rekey planning for older Pasadena doors.',
  gbp_cta_type: 'CALL',
  asset_delivered: 1,
  asset_count: 1,
  asset_rights_confirmed: 1,
  ready_for_automation: 1,
};

ok('clean ready post has no issues', () => {
  const audit = auditPostContentQuality(basePost);
  assert.equal(audit.issue_count, 0);
});

ok('missing platform adaptations are blockers', () => {
  const audit = auditPostContentQuality({ ...basePost, cap_instagram: '', youtube_description: '' });
  assert.ok(audit.issues.some((issue) => issue.code === 'MISSING_PLATFORM_ADAPTATIONS' && issue.severity === 'blocker'));
});

ok('generic language and overstrong claims are warnings', () => {
  const audit = auditPostContentQuality({
    ...basePost,
    cap_facebook: 'Ready to transform your home with no surprises and guaranteed lasting value.',
  });
  assert.ok(audit.issues.some((issue) => issue.code === 'GENERIC_MARKETING_LANGUAGE'));
  assert.ok(audit.issues.some((issue) => issue.code === 'UNSUPPORTED_OR_OVERSTRONG_OUTCOME_CLAIM'));
});

ok('media rights and ready gates are blockers', () => {
  const audit = auditPostContentQuality({ ...basePost, status: 'draft', ready_for_automation: 0, asset_delivered: 0, asset_count: 0, asset_rights_confirmed: 0 });
  assert.ok(audit.issues.some((issue) => issue.code === 'MEDIA_OR_RIGHTS_BLOCKER'));
  assert.ok(audit.issues.some((issue) => issue.code === 'NOT_READY_FOR_AUTOMATION'));
});

ok('multiple phone numbers are blockers', () => {
  const audit = auditPostContentQuality({ ...basePost, cap_facebook: 'Call (323) 346-7344 or (818) 401-3808.' });
  assert.ok(audit.issues.some((issue) => issue.code === 'MULTIPLE_PHONE_NUMBERS'));
});

ok('batch audit summarizes duplicate title families and issue counts', () => {
  const result = auditPostsContentQuality([
    basePost,
    { ...basePost, id: 'def987654321', title: 'Pasadena Lock Rekey Planning for Older Doors', cap_facebook: 'Ready to transform locks.' },
  ]);
  assert.equal(result.total, 2);
  assert.equal(result.duplicate_title_families.length, 1);
  assert.ok(result.issue_counts.GENERIC_MARKETING_LANGUAGE >= 1);
});

ok('generated draft gate blocks generic filler even when an AI score passes', () => {
  const issues = auditGeneratedDraftContent({
    title: 'Transform Your Los Angeles Home with Professional Remodeling',
    master_caption: 'Discover an ideal space with our expert team and peace of mind.',
    platform_captions: {
      facebook: 'Ready to elevate your home with our expert touch.',
      instagram: 'Dreaming of a home makeover? Trust the experts.',
    },
  });
  assert.ok(issues.some((issue) => issue.code === 'GENERIC_MARKETING_LANGUAGE' && issue.severity === 'blocker'));
});

ok('generated draft gate requires distinct Facebook and Instagram copy', () => {
  const issues = auditGeneratedDraftContent({
    title: 'Pasadena Deadbolt Alignment Before Hardware Replacement',
    master_caption: 'A dragging deadbolt can point to door alignment before the cylinder needs replacement.',
    platform_captions: { facebook: 'Check the bolt with the door open.', instagram: 'Check the bolt with the door open.' },
  });
  assert.ok(issues.some((issue) => issue.code === 'IDENTICAL_CORE_PLATFORM_COPY'));
});

console.log(`\n${passed} content quality audit tests passed`);
