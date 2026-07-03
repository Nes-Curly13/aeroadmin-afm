// Filter lands.json to only the missing externalIds, then run downloader.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

(async () => {
  const lands = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'djiag_exports', 'lands.json'), 'utf8'));
  const landList = Array.isArray(lands) ? lands : (lands.lands ?? []);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const db = await pool.query(`SELECT external_id FROM dji_parcels`);
  const dbIds = new Set(db.rows.map(r => r.external_id));
  await pool.end();

  const missing = landList.filter(l => l.externalId && !dbIds.has(l.externalId));
  console.log(`Missing: ${missing.length} lands`);

  if (missing.length === 0) {
    console.log('Nothing missing, skip');
    return;
  }

  const outPath = path.join(__dirname, '..', 'djiag_exports', 'lands-missing.json');
  fs.writeFileSync(outPath, JSON.stringify(missing, null, 2));
  console.log(`Wrote ${missing.length} lands to ${outPath}`);
  console.log('Run: node scripts/download-land-assets.js --in djiag_exports/lands-missing.json');
  console.log('Then: node import_djiag_data.js');
})();