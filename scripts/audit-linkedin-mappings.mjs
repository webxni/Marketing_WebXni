import fs from 'node:fs';
import path from 'node:path';

const seedPath = path.resolve('db/migrations/0002_accounts_map_seed.sql');
const sql = fs.readFileSync(seedPath, 'utf8');

const expected = [
  { slug: 'elite-team-builders', canonical: 'Elite Team Builders Inc.', uploadPostProfile: 'Elite_Team_Builders', linkedinPage: 'Elite Team Builders Inc.' },
  { slug: '724-locksmith', canonical: '7/24 Locksmith Services', uploadPostProfile: '7_24_Locksmith', linkedinPage: '7/24 Locksmith' },
  { slug: '247-lockout-locksmith', canonical: '24/7 Lockout Locksmith', uploadPostProfile: '24_7_Lockout', linkedinPage: '24/7 Lockout Locksmith Services' },
  { slug: 'golden-touch-roofing', canonical: 'Golden Touch Roofing', uploadPostProfile: 'Golden_Touch_Roofing', linkedinPage: 'Golden Touch Roofing' },
  { slug: 'americas-professional-builders', canonical: 'America’s Professional Builders Inc', uploadPostProfile: 'Americas_Professional_Builders', linkedinPage: 'America’s Professional Builders Inc' },
  { slug: 'webxni', canonical: 'WebXni', uploadPostProfile: 'WebXni', linkedinPage: 'WebXni' },
  { slug: 'unlockd-pros', canonical: 'Unlock´D Pros', uploadPostProfile: 'UnlockD_Pros', linkedinPage: 'Unlock´D Pros' },
  { slug: 'daniels-locks-key', canonical: "Daniel's Locks & Key", uploadPostProfile: 'Daniels_Locks_Key', linkedinPage: "Daniel’s Lock & Keys" },
  { slug: 'caliview-builders', canonical: 'CALI-VIEW BUILDERS', uploadPostProfile: 'Caliview_Builders', linkedinPage: 'Cali View Builders' },
];

function unescapeSql(value) {
  return value.replace(/''/g, "'");
}

function splitSqlTuple(tuple) {
  const values = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < tuple.length; i += 1) {
    const char = tuple[i];
    const next = tuple[i + 1];

    if (char === "'" && next === "'") {
      current += "''";
      i += 1;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }

    if (char === ',' && !inString) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') values.push(current.trim());
  return values;
}

function extractInsertBlocks(tableName) {
  const marker = `INSERT OR IGNORE INTO ${tableName}`;
  return sql
    .split(marker)
    .slice(1)
    .map((chunk) => `${marker}${chunk.split(');\n')[0]});`);
}

const clientsById = new Map();
const clientsBySlug = new Map();
for (const block of extractInsertBlocks('clients')) {
  const tuple = block.match(/VALUES\s*\(([\s\S]*?)\)\s*;/)?.[1];
  if (!tuple) continue;
  const values = splitSqlTuple(tuple);
  const id = unescapeSql(values[0].slice(1, -1));
  const slug = unescapeSql(values[1].slice(1, -1));
  const canonicalName = unescapeSql(values[2].slice(1, -1));
  const uploadPostProfile = values[10] === 'NULL' ? null : unescapeSql(values[10].slice(1, -1));
  clientsById.set(id, { id, slug, canonicalName, uploadPostProfile });
  clientsBySlug.set(slug, { id, slug, canonicalName, uploadPostProfile });
}

const linkedinByClientId = new Map();
for (const block of extractInsertBlocks('client_platforms')) {
  const tuple = block.match(/VALUES\s*\(([\s\S]*?)\)\s*;/)?.[1];
  if (!tuple) continue;
  const values = splitSqlTuple(tuple);
  const platform = values[2] === 'NULL' ? null : unescapeSql(values[2].slice(1, -1));
  if (platform !== 'linkedin') continue;
  const id = unescapeSql(values[0].slice(1, -1));
  const clientId = unescapeSql(values[1].slice(1, -1));
  const accountId = values[3] === 'NULL' ? null : unescapeSql(values[3].slice(1, -1));
  const username = values[4] === 'NULL' ? null : unescapeSql(values[4].slice(1, -1));
  const pageId = values[5] === 'NULL' ? null : unescapeSql(values[5].slice(1, -1));
  linkedinByClientId.set(clientId, { id, clientId, accountId, username, pageId });
}

const rows = expected.map((entry) => {
  const client = clientsBySlug.get(entry.slug) ?? null;
  const linkedin = client ? linkedinByClientId.get(client.id) ?? null : null;
  const pageId = linkedin?.pageId ?? null;
  const dryRunPayload = pageId
    ? {
        user: entry.uploadPostProfile,
        platform: 'linkedin',
        title: `Dry-run validation for ${entry.canonical}`,
        target_linkedin_page_id: pageId,
      }
    : null;

  return {
    ...entry,
    repoClientFound: !!client,
    repoProfile: client?.uploadPostProfile ?? null,
    pageId,
    accountId: linkedin?.accountId ?? null,
    status: pageId ? 'mapped' : 'missing_page_id',
    dryRunPayload,
  };
});

console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'db/migrations/0002_accounts_map_seed.sql',
  rows,
}, null, 2));
