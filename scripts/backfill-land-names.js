// Backfill land_name on dji_parcels from djiag_exports/lands.json.
//
// Why: import_djiag_data.js reads land_name from .kml files, but the downloader
// only fetches .json (geometry/parameter/waypoint). So land_name ends up NULL
// for all 1198 parcels. We patch it from lands.json (the source of truth from
// DJI's GraphQL) using a simple UPDATE JOIN.

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
  console.log(`[backfill-names] ${landList.length} lands en lands.json`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let updated = 0;
    let skippedNoName = 0;
    let skippedNoExt = 0;
    for (const land of landList) {
      if (!land.externalId) { skippedNoExt++; continue; }
      if (!land.name) { skippedNoName++; continue; }
      const r = await client.query(
        `UPDATE dji_parcels SET land_name = $1 WHERE external_id = $2`,
        [land.name, land.externalId]
      );
      if (r.rowCount > 0) updated += r.rowCount;
    }
    await client.query('COMMIT');
    console.log(`[backfill-names] updated=${updated} skippedNoName=${skippedNoName} skippedNoExt=${skippedNoExt}`);

    const verify = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE land_name IS NOT NULL) AS with_name,
        COUNT(*) FILTER (WHERE land_name IS NULL) AS without_name
      FROM dji_parcels
    `);
    console.log('[backfill-names] post-state:', JSON.stringify(verify.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[backfill-names] ERR:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();