import test from 'node:test';
import assert from 'node:assert/strict';
import {
  automationSlotKey,
  normalizePackageSlot,
  packageSocialSlots,
  recoveryPackageSlotsForClient,
} from './agency-package-slots.mjs';

test('recoveryPackageSlotsForClient normalizes current-week missing slots from scheduler payloads', () => {
  const client = { client_id: 'client-1' };
  const taskInput = {
    mode: 'recover_missing_slots',
    client_id: 'client-1',
    missing_slots: [
      { date: '2026-08-18', type: 'image', dailyIndex: 0, slotKey: 'client-1:2026-08-18:image:0' },
      { date: '2026-08-20', type: 'blog', dailyIndex: 1 },
    ],
  };

  const slots = recoveryPackageSlotsForClient(client, taskInput, 'social');

  assert.deepEqual(slots, [{ day: 'tuesday', date: '2026-08-18', type: 'image', dailyIndex: 0 }]);
  assert.equal(automationSlotKey(client.client_id, slots[0]), 'client-1:2026-08-18:image:0');
});

test('recoveryPackageSlotsForClient returns an empty list for other clients', () => {
  const slots = recoveryPackageSlotsForClient(
    { client_id: 'client-2' },
    { mode: 'recover_missing_slots', client_id: 'client-1', missing_slots: [{ date: '2026-08-18', type: 'image', dailyIndex: 0 }] },
    'social',
  );

  assert.deepEqual(slots, []);
});

test('recoveryPackageSlotsForClient returns null outside recovery mode so normal next-week scheduling stays unchanged', () => {
  const client = {
    client_id: 'client-1',
    weekly_schedule: JSON.stringify({ monday: ['image'] }),
    images_per_month: 4,
    videos_per_month: 0,
    reels_per_month: 0,
    blog_posts_per_month: 0,
  };

  assert.equal(recoveryPackageSlotsForClient(client, { mode: 'agency_scheduler' }, 'social'), null);
  assert.deepEqual(packageSocialSlots(client, new Date('2026-08-18T12:00:00Z')), [
    { day: 'monday', date: '2026-08-24', type: 'image', dailyIndex: 0 },
  ]);
});

test('normalizePackageSlot rejects invalid scheduler payloads', () => {
  assert.equal(normalizePackageSlot({ date: 'bad', type: 'image' }), null);
  assert.equal(normalizePackageSlot({ date: '2026-08-18', type: '' }), null);
});
