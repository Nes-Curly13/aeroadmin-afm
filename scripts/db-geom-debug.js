// Diagnóstico de geometrías inválidas
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const envFile = fs.readFileSync(envPath, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  try {
    console.log('=== Razón de invalidez (PostGIS) ===');
    const r = await client.query(`
      SELECT land_name, external_id,
        ST_IsValidReason(spray_geom) AS reason,
        ST_NPoints(spray_geom) AS n_points
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
        AND NOT ST_IsValid(spray_geom)
      ORDER BY land_name NULLS LAST
      LIMIT 20
    `);
    for (const row of r.rows) {
      console.log(`  ${row.land_name || row.external_id} (${row.n_points} pts): ${row.reason}`);
    }

    console.log('\n=== Intento de reparación con ST_MakeValid ===');
    const r2 = await client.query(`
      SELECT count(*) AS n,
        count(CASE WHEN ST_IsValid(ST_MakeValid(spray_geom)) THEN 1 END) AS repairable
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
        AND NOT ST_IsValid(spray_geom)
    `);
    console.log(JSON.stringify(r2.rows[0], null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
main();
