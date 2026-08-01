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
    const r1 = await pool.query(`
      SELECT f.flight_id, f.parcel_id, f.drone_nickname, p.land_name, p.batch_id
      FROM dji_flights f
      LEFT JOIN dji_parcels p ON p.id = f.parcel_id
      WHERE f.parcel_id IS NOT NULL AND f.drone_nickname IS NOT NULL
      ORDER BY f.start_at DESC NULLS LAST
      LIMIT 5
    `);
    console.log('recent matched flights:');
    for (const r of r1.rows) {
      console.log(`  flight_id=${r.flight_id} parcel_id=${r.parcel_id} land_name=${r.land_name ?? 'NULL'} batch=${r.batch_id ?? 'NULL'}`);
    }

    const r2 = await pool.query(`
      SELECT COUNT(*) AS n
      FROM dji_flights f
      WHERE f.parcel_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM dji_parcels p WHERE p.id = f.parcel_id)
    `);
    console.log(`\nflights with stale parcel_id (parcel no longer exists): ${r2.rows[0].n}`);

    const r3 = await pool.query(`SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS total FROM dji_parcels`);
    console.log(`dji_parcels id range: ${r3.rows[0].min_id}..${r3.rows[0].max_id} (${r3.rows[0].total} rows)`);

    const r4 = await pool.query(`
      SELECT MIN(parcel_id) AS min, MAX(parcel_id) AS max, COUNT(*) FILTER (WHERE parcel_id IS NOT NULL) AS with_parcel
      FROM dji_flights
    `);
    console.log(`dji_flights.parcel_id range: ${r4.rows[0].min}..${r4.rows[0].max} (${r4.rows[0].with_parcel} matched)`);
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });