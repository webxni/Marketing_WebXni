-- Keep approved topic keywords aligned with their target market.

UPDATE client_monthly_topics
SET target_keyword = 'Austin Home Remodeling',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND plan_month = '2026-08'
  AND slot_number = 11;

UPDATE client_monthly_topics
SET target_keyword = 'Bathroom Remodeling Austin',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND plan_month = '2026-08'
  AND slot_number = 19;

UPDATE client_monthly_topics
SET target_keyword = 'Kitchen Remodeling Austin',
    updated_at = unixepoch()
WHERE client_id = (SELECT id FROM clients WHERE slug = 'modern-vision-remodeling')
  AND plan_month = '2026-08'
  AND slot_number = 21;
