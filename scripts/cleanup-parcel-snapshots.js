// Cleanup dji_parcels: backup batch 1, drop batch 1, keep batch 2.
//
// Why: upsert-lands-from-djiag.js is designed as snapshots (UNIQUE(batch_id,
// external_id)) but creates a new batch per run. Dashboard queries don't
// filter by batch_id, so a re-run shows duplicates. Each run creates new
// pkey IDs, so we'd never upsert in-place — the design is "drop old, run new".
//
// Steps:
//   1. CREATE backup table dji_parcels_backup_batch1_YYYYMMDD with batch=1 rows
//   2. DELETE FROM dji_parcels WHERE batch_id = 1
//   3. Verify counts (expect: total = 1200, unique_external = 1200)
//
// Reversible: backup table preserved. To undo: INSERT ... SELECT FROM backup.

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

const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const BACKUP_TABLE = `dji_parcels_backup_batch1_${date}`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const client = await pool.connect();
  try {
    console.log(`[cleanup] target: keep batch 2 (1200 fresh lands), drop batch 1 (1198 stale)`);

    const pre = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE batch_id = 1) AS batch_1,
        COUNT(*) FILTER (WHERE batch_id = 2) AS batch_2,
        COUNT(DISTINCT external_id) AS unique_external
      FROM dji_parcels
    `);
    console.log('[cleanup] pre-state:', JSON.stringify(pre.rows[0]));

    if (Number(pre.rows[0].batch_1) === 0) {
      console.log('[cleanup] batch 1 already empty — nothing to do');
      return;
    }

    console.log(`[cleanup] step 1/3 — creating backup table ${BACKUP_TABLE}`);
    await client.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
    await client.query(`
      CREATE TABLE ${BACKUP_TABLE} AS
      SELECT * FROM dji_parcels WHERE batch_id = 1
    `);
    const bc = await client.query(`SELECT COUNT(*) AS n FROM ${BACKUP_TABLE}`);
    console.log(`[cleanup]   backup rows: ${bc.rows[0].n}`);

    console.log('[cleanup] step 2/3 — DELETE batch 1 rows');
    const del = await client.query(`DELETE FROM dji_parcels WHERE batch_id = 1`);
    console.log(`[cleanup]   deleted: ${del.rowCount}`);

    console.log('[cleanup] step 3/3 — verify post-state');
    const post = await client.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT external_id) AS unique_external,
        COUNT(*) FILTER (WHERE spray_geom IS NOT NULL) AS with_spray_geom
      FROM dji_parcels
    `);
    console.log('[cleanup] post-state:', JSON.stringify(post.rows[0]));

    if (Number(post.rows[0].total) !== Number(post.rows[0].unique_external)) {
      throw new Error(`post-state still has dupes: total=${post.rows[0].total} unique=${post.rows[0].unique_external}`);
    }

    console.log(`[cleanup] DONE. To undo: INSERT INTO dji_parcels SELECT * FROM ${BACKUP_TABLE};`);
  } catch (e) {
    console.error('[cleanup] ERR:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();