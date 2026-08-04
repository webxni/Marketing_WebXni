import assert from 'node:assert/strict';
import { automationSlotKey, deliveryPlatforms, packageBlogSlots, packageSocialSlots, packageSlots } from './lib/agency-package-slots.mjs';

const basic = {
  weekly_schedule: JSON.stringify({ monday: ['image'], wednesday: ['video'], friday: ['image'] }),
  images_per_month: 9,
  videos_per_month: 4,
  reels_per_month: 0,
  blog_posts_per_month: 0,
  platforms_included: JSON.stringify(['facebook', 'instagram', 'youtube']),
};

const firstAugustWeek = packageSlots(basic, new Date('2026-07-31T12:00:00Z'));
assert.deepEqual(firstAugustWeek.map((slot) => `${slot.day}:${slot.type}`), ['monday:image', 'wednesday:video', 'friday:image']);

const lastSeptemberWeek = packageSlots(basic, new Date('2026-09-27T12:00:00Z'));
assert.equal(lastSeptemberWeek.filter((slot) => slot.type === 'video').length, 0, 'monthly video cap must suppress the fifth Wednesday');
assert.equal(packageBlogSlots(basic, new Date('2026-07-31T12:00:00Z')).length, 0);
assert.equal(packageSocialSlots(basic, new Date('2026-07-31T12:00:00Z')).length, 3);

const first = firstAugustWeek[0];
assert.equal(automationSlotKey('client1', first), 'client1:2026-08-03:image:0');
assert.deepEqual(deliveryPlatforms(
  basic,
  { active_platforms: ['facebook', 'instagram', 'youtube', 'linkedin'] },
  'video',
  {},
), ['facebook', 'instagram', 'youtube']);

console.log('agency package slot tests passed');
