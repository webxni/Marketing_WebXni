-- Migration 0008: Merge duplicate client records
-- OLD (has Upload-Post account data, no Notion/intelligence)
-- NEW (has Notion page ID + intelligence, no account IDs)
-- Strategy: copy upload_post_profile + platform account data into NEW, then delete OLD

-- ══════════════════════════════════════════════════════════════
-- STEP 1: Copy upload_post_profile from OLD → NEW
-- ══════════════════════════════════════════════════════════════
UPDATE clients SET upload_post_profile = '24_7_Lockout'      WHERE slug = '247-lockout-pasadena';
UPDATE clients SET upload_post_profile = '7_24_Locksmith'    WHERE slug = '724-locksmith-ca';
UPDATE clients SET upload_post_profile = 'Daniels_Locks_Key' WHERE slug = 'daniels-locksmith';
UPDATE clients SET upload_post_profile = 'Ketty_Robles'      WHERE slug = 'ketty-s-robles-accounting';
UPDATE clients SET upload_post_profile = 'UnlockD_Pros'      WHERE slug = 'unlocked-pros';

-- ══════════════════════════════════════════════════════════════
-- STEP 2: Copy platform account data OLD → NEW (matching platforms)
-- ══════════════════════════════════════════════════════════════

-- 247-lockout-locksmith → 247-lockout-pasadena
UPDATE client_platforms SET
  account_id              = (SELECT o.account_id              FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform),
  username                = (SELECT o.username                FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform),
  page_id                 = (SELECT o.page_id                 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform),
  upload_post_board_id    = (SELECT o.upload_post_board_id    FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform),
  upload_post_location_id = (SELECT o.upload_post_location_id FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform)
WHERE client_id = (SELECT id FROM clients WHERE slug = '247-lockout-pasadena')
  AND EXISTS (SELECT 1 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '247-lockout-locksmith' AND o.platform = client_platforms.platform);

-- 724-locksmith → 724-locksmith-ca
UPDATE client_platforms SET
  account_id              = (SELECT o.account_id              FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform),
  username                = (SELECT o.username                FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform),
  page_id                 = (SELECT o.page_id                 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform),
  upload_post_board_id    = (SELECT o.upload_post_board_id    FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform),
  upload_post_location_id = (SELECT o.upload_post_location_id FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform)
WHERE client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca')
  AND EXISTS (SELECT 1 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = '724-locksmith' AND o.platform = client_platforms.platform);

-- daniels-locks-key → daniels-locksmith
UPDATE client_platforms SET
  account_id              = (SELECT o.account_id              FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform),
  username                = (SELECT o.username                FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform),
  page_id                 = (SELECT o.page_id                 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform),
  upload_post_board_id    = (SELECT o.upload_post_board_id    FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform),
  upload_post_location_id = (SELECT o.upload_post_location_id FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform)
WHERE client_id = (SELECT id FROM clients WHERE slug = 'daniels-locksmith')
  AND EXISTS (SELECT 1 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'daniels-locks-key' AND o.platform = client_platforms.platform);

-- ketty-robles-accounting → ketty-s-robles-accounting
UPDATE client_platforms SET
  account_id              = (SELECT o.account_id              FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform),
  username                = (SELECT o.username                FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform),
  page_id                 = (SELECT o.page_id                 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform),
  upload_post_board_id    = (SELECT o.upload_post_board_id    FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform),
  upload_post_location_id = (SELECT o.upload_post_location_id FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform)
WHERE client_id = (SELECT id FROM clients WHERE slug = 'ketty-s-robles-accounting')
  AND EXISTS (SELECT 1 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'ketty-robles-accounting' AND o.platform = client_platforms.platform);

-- Insert any OLD platforms that NEW doesn't have yet
INSERT OR IGNORE INTO client_platforms (id, client_id, platform, paused)
  SELECT hex(randomblob(16)), (SELECT id FROM clients WHERE slug = '247-lockout-pasadena'), o.platform, 0
  FROM client_platforms o JOIN clients oc ON o.client_id = oc.id
  WHERE oc.slug = '247-lockout-locksmith'
    AND o.platform NOT IN (SELECT platform FROM client_platforms WHERE client_id = (SELECT id FROM clients WHERE slug = '247-lockout-pasadena'));

INSERT OR IGNORE INTO client_platforms (id, client_id, platform, paused)
  SELECT hex(randomblob(16)), (SELECT id FROM clients WHERE slug = '724-locksmith-ca'), o.platform, 0
  FROM client_platforms o JOIN clients oc ON o.client_id = oc.id
  WHERE oc.slug = '724-locksmith'
    AND o.platform NOT IN (SELECT platform FROM client_platforms WHERE client_id = (SELECT id FROM clients WHERE slug = '724-locksmith-ca'));

INSERT OR IGNORE INTO client_platforms (id, client_id, platform, paused)
  SELECT hex(randomblob(16)), (SELECT id FROM clients WHERE slug = 'daniels-locksmith'), o.platform, 0
  FROM client_platforms o JOIN clients oc ON o.client_id = oc.id
  WHERE oc.slug = 'daniels-locks-key'
    AND o.platform NOT IN (SELECT platform FROM client_platforms WHERE client_id = (SELECT id FROM clients WHERE slug = 'daniels-locksmith'));

INSERT OR IGNORE INTO client_platforms (id, client_id, platform, paused)
  SELECT hex(randomblob(16)), (SELECT id FROM clients WHERE slug = 'ketty-s-robles-accounting'), o.platform, 0
  FROM client_platforms o JOIN clients oc ON o.client_id = oc.id
  WHERE oc.slug = 'ketty-robles-accounting'
    AND o.platform NOT IN (SELECT platform FROM client_platforms WHERE client_id = (SELECT id FROM clients WHERE slug = 'ketty-s-robles-accounting'));

INSERT OR IGNORE INTO client_platforms (id, client_id, platform, paused)
  SELECT hex(randomblob(16)), (SELECT id FROM clients WHERE slug = 'unlocked-pros'), o.platform, 0
  FROM client_platforms o JOIN clients oc ON o.client_id = oc.id
  WHERE oc.slug = 'unlockd-pros'
    AND o.platform NOT IN (SELECT platform FROM client_platforms WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros'));

-- unlockd-pros → unlocked-pros (account data)
UPDATE client_platforms SET
  account_id              = (SELECT o.account_id              FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform),
  username                = (SELECT o.username                FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform),
  page_id                 = (SELECT o.page_id                 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform),
  upload_post_board_id    = (SELECT o.upload_post_board_id    FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform),
  upload_post_location_id = (SELECT o.upload_post_location_id FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform)
WHERE client_id = (SELECT id FROM clients WHERE slug = 'unlocked-pros')
  AND EXISTS (SELECT 1 FROM client_platforms o JOIN clients oc ON o.client_id = oc.id WHERE oc.slug = 'unlockd-pros' AND o.platform = client_platforms.platform);

-- ══════════════════════════════════════════════════════════════
-- STEP 3: Delete OLD client sub-records, then OLD clients
-- (explicit deletes in case ON DELETE CASCADE isn't enforced)
-- ══════════════════════════════════════════════════════════════
DELETE FROM client_platforms WHERE client_id IN (
  SELECT id FROM clients WHERE slug IN ('247-lockout-locksmith','724-locksmith','daniels-locks-key','ketty-robles-accounting','unlockd-pros')
);
DELETE FROM client_intelligence WHERE client_id IN (
  SELECT id FROM clients WHERE slug IN ('247-lockout-locksmith','724-locksmith','daniels-locks-key','ketty-robles-accounting','unlockd-pros')
);
DELETE FROM client_platform_links WHERE client_id IN (
  SELECT id FROM clients WHERE slug IN ('247-lockout-locksmith','724-locksmith','daniels-locks-key','ketty-robles-accounting','unlockd-pros')
);
DELETE FROM notion_sync_log WHERE entity_id IN (
  SELECT id FROM clients WHERE slug IN ('247-lockout-locksmith','724-locksmith','daniels-locks-key','ketty-robles-accounting','unlockd-pros')
);
DELETE FROM clients WHERE slug IN (
  '247-lockout-locksmith','724-locksmith','daniels-locks-key','ketty-robles-accounting','unlockd-pros'
);
