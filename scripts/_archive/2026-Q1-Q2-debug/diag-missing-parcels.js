// Compare lands.json external_ids vs dji_parcels external_ids
// Find which 2 fincas from lands.json are missing in DB.
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  try {
    const lands = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'djiag_exports', 'lands.json'), 'utf8'));
    const landList = Array.isArray(lands) ? lands : (lands.lands ?? []);
    const landsIds = new Set(landList.map(l => l.externalId).filter(Boolean));
    console.log(`lands.json: ${landList.length} lands, ${landsIds.size} unique externalIds`);

    const db = await pool.query(`SELECT external_id, land_name FROM dji_parcels`);
    const dbIds = new Set(db.rows.map(r => r.external_id));
    console.log(`dji_parcels: ${db.rows.length} rows, ${dbIds.size} unique externalIds`);

    const missing = [...landsIds].filter(id => !dbIds.has(id));
    console.log(`\nMissing in DB (in lands.json, not in dji_parcels): ${missing.length}`);
    for (const id of missing) {
      const l = landList.find(x => x.externalId === id);
      console.log(`  - ${id} → "${l?.name}" (uuid=${l?.uuid})`);
    }

    // Check filesystem for the missing ones
    const filesDir = path.join(__dirname, '..', 'djiag_exports', 'land_files');
    console.log(`\nFilesystem check (${filesDir}):`);
    for (const id of missing) {
      // Filename pattern is likely {externalId}_geometry.json etc.
      const variants = [id, id.replace(/-/g, ''), id.split('-').slice(-1)[0]];
      let found = [];
      try {
        for (const file of fs.readdirSync(filesDir)) {
          for (const v of variants) {
            if (file.startsWith(v) || file.includes(v)) { found.push(file); break; }
          }
        }
      } catch (e) { console.log(`  ${id}: ERR ${e.message}`); continue; }
      console.log(`  ${id}: ${found.length} files`);
      for (const f of found.slice(0, 5)) console.log(`    - ${f}`);
    }
  } finally {
    await pool.end();
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });