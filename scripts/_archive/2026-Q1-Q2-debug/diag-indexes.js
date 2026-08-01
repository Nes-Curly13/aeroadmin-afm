// Check indexes/constraints on dji_parcels
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
    const idx = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'dji_parcels'
      ORDER BY indexname
    `);
    console.log('INDEXES:');
    for (const r of idx.rows) console.log(`  ${r.indexname}: ${r.indexdef}`);

    const cons = await pool.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'dji_parcels'::regclass
      ORDER BY conname
    `);
    console.log('CONSTRAINTS:');
    for (const r of cons.rows) console.log(`  ${r.conname} (${r.contype}): ${r.def}`);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });