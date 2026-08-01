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
    // What the test selects: ORDER BY start_at DESC NULLS LAST, LIMIT 1
    const r = await pool.query(`
      SELECT flight_id, parcel_id, start_at, end_at, area_m2, spray_usage_ml, drone_nickname, pilot_name, mode_name
      FROM dji_flights
      WHERE parcel_id IS NOT NULL AND drone_nickname IS NOT NULL
      ORDER BY start_at DESC NULLS LAST
      LIMIT 5
    `);
    console.log('top 5 flights by start_at (with parcel_id + drone_nickname):');
    for (const row of r.rows) {
      console.log(`  flight=${row.flight_id} parcel=${row.parcel_id} start=${row.start_at?.toISOString()?.slice(0, 16)} area_m2=${row.area_m2} spray_ml=${row.spray_usage_ml} drone=${row.drone_nickname}`);
    }

    // How many flights have area_m2 = 0?
    const stats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE area_m2 = 0 OR area_m2 IS NULL) AS zero_or_null,
        COUNT(*) FILTER (WHERE area_m2 > 0) AS positive
      FROM dji_flights
    `);
    console.log('\narea_m2 stats:', JSON.stringify(stats.rows[0]));

    // Among flights with parcel_id AND drone_nickname, how many have area_m2 > 0?
    const stats2 = await pool.query(`
      SELECT
        COUNT(*) AS matched,
        COUNT(*) FILTER (WHERE area_m2 > 0) AS with_area
      FROM dji_flights
      WHERE parcel_id IS NOT NULL AND drone_nickname IS NOT NULL
    `);
    console.log('among matched:', JSON.stringify(stats2.rows[0]));
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });