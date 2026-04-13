-- Migration 0015: Update package definitions to optimized three-tier structure
-- Basic:   3x/week (Mon/Wed/Fri),  ~10 posts/month
-- Medium:  Daily Mon–Fri,          ~22 posts/month
-- Premium: Daily Mon–Fri + Sat,    ~48 posts/month (~40–60 range)

UPDATE packages SET
  name                 = 'Basic',
  posts_per_month      = 10,
  images_per_month     = 8,
  videos_per_month     = 4,
  reels_per_month      = 2,
  blog_posts_per_month = 0,
  posting_frequency    = '3x_week',
  posting_days         = '["monday","wednesday","friday"]',
  cadence_notes        = '2 images + 1 video per day (Mon/Wed/Fri). ~8–10 posts/month. Presencia mínima + consistencia.',
  includes_gbp         = 0,
  includes_blog        = 0,
  sort_order           = 10,
  updated_at           = unixepoch()
WHERE slug = 'basic';

UPDATE packages SET
  name                 = 'Medium',
  posts_per_month      = 22,
  images_per_month     = 12,
  videos_per_month     = 8,
  reels_per_month      = 8,
  blog_posts_per_month = 2,
  posting_frequency    = 'daily',
  posting_days         = '["monday","tuesday","wednesday","thursday","friday"]',
  cadence_notes        = '3 images + 2 videos + 2 reels per week, 1 blog biweekly (Mon–Fri). ~20–24 posts/month. Crecimiento + consistencia + leads.',
  includes_gbp         = 1,
  includes_blog        = 1,
  sort_order           = 20,
  updated_at           = unixepoch()
WHERE slug = 'medium';

UPDATE packages SET
  name                 = 'Premium',
  posts_per_month      = 48,
  images_per_month     = 10,
  videos_per_month     = 20,
  reels_per_month      = 20,
  blog_posts_per_month = 4,
  posting_frequency    = 'daily',
  posting_days         = '["monday","tuesday","wednesday","thursday","friday","saturday"]',
  cadence_notes        = '1–2 videos daily + 5–7 reels + 2–3 images + 1–2 blogs per week (Mon–Sat). ~40–60 posts/month. Dominación en reach + autoridad.',
  includes_gbp         = 1,
  includes_blog        = 1,
  sort_order           = 30,
  updated_at           = unixepoch()
WHERE slug = 'premium';
