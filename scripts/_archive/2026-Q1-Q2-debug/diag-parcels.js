// Diagnose dji_parcels duplication after upsert
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const cols = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'dji_parcels' ORDER BY ordinal_position
    `);
    console.log('dji_parcels columns:', cols.rows.map(r => r.column_name).join(', '));

    const r = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT external_id) AS unique_external,
        COUNT(*) FILTER (WHERE batch_id = 1) AS from_batch_1,
        COUNT(*) FILTER (WHERE batch_id = 2) AS from_batch_2
      FROM dji_parcels
    `);
    console.log('parcels summary:', JSON.stringify(r.rows[0], null, 2));

    const dup = await pool.query(`
      SELECT external_id, COUNT(*) AS copies, MIN(batch_id) AS first_batch, MAX(batch_id) AS last_batch
      FROM dji_parcels
      GROUP BY external_id
      HAVING COUNT(*) > 1
      ORDER BY copies DESC
      LIMIT 5
    `);
    console.log('duplicates (top 5):', JSON.stringify(dup.rows, null, 2));

    const dupCount = await pool.query(`SELECT COUNT(*) AS n FROM (SELECT external_id FROM dji_parcels GROUP BY external_id HAVING COUNT(*) > 1) t`);
    console.log('total external_ids with duplicates:', dupCount.rows[0].n);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });