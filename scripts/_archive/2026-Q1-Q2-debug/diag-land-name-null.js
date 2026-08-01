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
    // How many parcels have land_name NULL?
    const r1 = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE land_name IS NULL) AS null_land_name,
        COUNT(*) FILTER (WHERE land_name IS NOT NULL) AS with_land_name
      FROM dji_parcels
    `);
    console.log('land_name stats:', JSON.stringify(r1.rows[0]));

    // Sample 10 rows with land_name NULL
    const r2 = await pool.query(`
      SELECT id, external_id, land_name, field_type, source_url_parameter, raw_parameter::text AS raw_param_preview
      FROM dji_parcels
      WHERE land_name IS NULL
      LIMIT 3
    `);
    console.log('\nsample rows with land_name NULL:');
    for (const r of r2.rows) {
      console.log(`  id=${r.id} ext=${r.external_id?.slice(0, 40)} name=${r.land_name} field=${r.field_type}`);
      console.log(`    param_url=${r.source_url_parameter}`);
      console.log(`    raw_param: ${(r.raw_param_preview || '').slice(0, 200)}`);
    }

    // What's the row with id=65 specifically?
    const r3 = await pool.query(`
      SELECT id, external_id, land_name, field_type, source_url_parameter,
             raw_parameter::text AS raw_param,
             source_url_geometry
      FROM dji_parcels WHERE id = 65
    `);
    console.log('\nrow id=65:', JSON.stringify(r3.rows[0], null, 2));
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });