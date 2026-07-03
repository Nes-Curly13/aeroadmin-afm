// Validate DB after import
const fs = require('fs');
const envFile = fs.readFileSync('.env.local', 'utf8');
let DATABASE_URL;
for (const line of envFile.split(/\r?\n/)) {
  const m = line.match(/^DATABASE_URL=(.+)$/);
  if (m) { DATABASE_URL = m[1].trim(); }
}
if (!DATABASE_URL) { console.error('DATABASE_URL not found'); process.exit(1); }

const { Pool } = require('pg');
const pool = new Pool({ connectionString: DATABASE_URL });

(async () => {
  const c = await pool.connect();
  try {
    console.log('=== DB VALIDATION POST-IMPORT ===\n');

    const r1 = await c.query(`
      SELECT
        COUNT(*) AS n_total,
        COUNT(spray_geom) AS n_spray_geom,
        COUNT(waypoints) AS n_waypoints,
        COUNT(reference_point) AS n_ref_point,
        COUNT(raw_geometry::text > ' ') AS n_raw_geom,
        COUNT(raw_parameter::text > ' ') AS n_raw_param,
        COUNT(raw_waypoint::text > ' ') AS n_raw_waypoint
      FROM dji_parcels
    `);
    console.log('parcels summary:', r1.rows[0]);

    const r2 = await c.query(`
      SELECT drone_model_code, COUNT(*) AS n
      FROM dji_parcels
      GROUP BY drone_model_code
      ORDER BY n DESC
    `);
    console.log('\nby drone_model_code:', r2.rows);

    const r3 = await c.query(`
      SELECT field_type, is_orchard, COUNT(*) AS n
      FROM dji_parcels
      GROUP BY field_type, is_orchard
      ORDER BY n DESC
      LIMIT 10
    `);
    console.log('\nby field_type:', r3.rows);

    const r4 = await c.query(`
      SELECT crop_type, recommended_cadence_days, COUNT(*) AS n
      FROM dji_fumigation_schedule
      GROUP BY crop_type, recommended_cadence_days
      ORDER BY n DESC
    `);
    console.log('\nschedule distribution:', r4.rows);

    const r5 = await c.query(`
      SELECT
        ROUND(AVG(declared_area_ha)::numeric, 2) AS avg_declared_ha,
        ROUND(AVG(spray_area_m2)::numeric, 2) AS avg_spray_m2,
        ROUND(AVG(waypoint_count)::numeric, 1) AS avg_waypoint_count
      FROM dji_parcels
      WHERE spray_area_m2 IS NOT NULL
    `);
    console.log('\narea stats:', r5.rows[0]);

    const r6 = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE spray_geom IS NOT NULL) AS total_geom,
        COUNT(*) FILTER (WHERE spray_geom IS NOT NULL AND ST_IsValid(spray_geom)) AS valid_geom
      FROM dji_parcels
    `);
    console.log('\ngeometry validity:', r6.rows[0]);

    const r8 = await c.query(`
      SELECT
        ROUND(SUM(ST_Area(spray_geom::geography) / 10000)::numeric, 2) AS total_spray_area_ha
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
    `);
    console.log('\ntotal spray area (ha):', r8.rows[0]);

    const r9 = await c.query(`
      SELECT external_id, land_name, ST_AsText(ST_Centroid(spray_geom)) AS centroid
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
      ORDER BY id
      LIMIT 3
    `);
    console.log('\nsample parcels (with geometry):');
    for (const row of r9.rows) {
      console.log(' ', row.external_id, '|', row.land_name, '|', row.centroid);
    }
  } finally {
    c.release();
    await pool.end();
  }
})();