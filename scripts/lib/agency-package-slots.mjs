function parseWeeklySchedule(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function monthlyLimit(client, type) {
  if (type === 'blog') return Number(client.blog_posts_per_month || 0);
  if (type === 'video') return Number(client.videos_per_month || 0);
  if (type === 'reel') return Number(client.reels_per_month || 0);
  return Number(client.images_per_month || 0);
}

function nextMonday(referenceDate) {
  const now = new Date(referenceDate);
  const utcDay = now.getUTCDay();
  const daysToMonday = utcDay === 0 ? 1 : (8 - utcDay) % 7 || 7;
  now.setUTCDate(now.getUTCDate() + daysToMonday);
  return now.toISOString().slice(0, 10);
}

export function packageSlots(client, referenceDate = new Date()) {
  const weeklySchedule = parseWeeklySchedule(client.weekly_schedule);
  const monday = nextMonday(referenceDate);
  const targetDates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${monday}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
  const targetSet = new Set(targetDates);
  const targetMonths = [...new Set(targetDates.map((date) => date.slice(0, 7)))];
  const slots = [];

  for (const month of targetMonths) {
    const [year, monthNumber] = month.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const used = {};
    for (let dayOfMonth = 1; dayOfMonth <= monthEnd; dayOfMonth++) {
      const date = `${month}-${String(dayOfMonth).padStart(2, '0')}`;
      const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()];
      const types = Array.isArray(weeklySchedule[day]) ? weeklySchedule[day] : [];
      for (const [dailyIndex, rawType] of types.entries()) {
        const type = String(rawType || '').toLowerCase();
        const limit = monthlyLimit(client, type);
        if (limit <= 0) continue;
        const next = Number(used[type] || 0) + 1;
        if (next > limit) continue;
        used[type] = next;
        if (targetSet.has(date)) slots.push({ day, date, type, dailyIndex });
      }
    }
  }

  return slots;
}

export function packageSocialSlots(client, referenceDate) {
  return packageSlots(client, referenceDate).filter((slot) => slot.type !== 'blog');
}

export function packageBlogSlots(client, referenceDate) {
  return packageSlots(client, referenceDate).filter((slot) => slot.type === 'blog');
}

export function normalizePackageSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const date = String(slot.date || '').slice(0, 10);
  const type = String(slot.type || '').toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !type) return null;
  const dailyIndex = Number.isInteger(slot.dailyIndex) ? slot.dailyIndex : Number(slot.dailyIndex || 0);
  const day = String(slot.day || ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()]);
  return { day, date, type, dailyIndex: Number.isFinite(dailyIndex) ? dailyIndex : 0 };
}

export function recoveryPackageSlotsForClient(client, taskInput, contentKind = 'all') {
  if (taskInput?.mode !== 'recover_missing_slots') return null;
  if (taskInput.client_id && String(taskInput.client_id) !== String(client.client_id)) return [];
  const slots = (Array.isArray(taskInput.missing_slots) ? taskInput.missing_slots : [])
    .map(normalizePackageSlot)
    .filter(Boolean)
    .filter((slot) => contentKind === 'all' ? true : contentKind === 'blog' ? slot.type === 'blog' : slot.type !== 'blog');
  return slots;
}

export function automationSlotKey(clientId, slot) {
  return `${clientId}:${slot.date}:${slot.type}:${slot.dailyIndex}`;
}

function parsePlatformList(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function deliveryPlatforms(client, brief, contentType, captions = {}) {
  const allowedByType = {
    image: ['facebook', 'instagram', 'linkedin', 'x', 'threads', 'pinterest', 'bluesky', 'google_business'],
    reel: ['instagram', 'facebook', 'tiktok', 'youtube', 'threads'],
    video: ['facebook', 'instagram', 'youtube', 'linkedin', 'x'],
    blog: ['website_blog'],
  };
  const connected = new Set(parsePlatformList(brief.active_platforms));
  const packaged = new Set(parsePlatformList(client.platforms_included));
  const allowed = new Set(allowedByType[contentType] || allowedByType.image);
  const selected = [...connected].filter((platform) => allowed.has(platform) && (packaged.size === 0 || packaged.has(platform)));
  return selected.filter((platform) => platform !== 'google_business' || Boolean(captions.google_business));
}
