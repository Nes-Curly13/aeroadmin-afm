// Validación post-import: integridad de dji_parcels
// Uso: node scripts/db-validate.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('No se encontró .env.local');
    process.exit(1);
  }
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
    console.log('=== 1. Conteo y shape de dji_parcels ===');
    const r1 = await client.query(`
      SELECT
        count(*)                                            AS total,
        count(spray_geom)                                   AS with_geom,
        count(reference_point)                              AS with_ref_point,
        count(waypoints)                                    AS with_waypoints,
        count(declared_area_ha)                             AS with_declared_area,
        count(drone_model_name)                             AS with_drone_name,
        count(CASE WHEN spray_area_m2 > 0 THEN 1 END)       AS with_spray_area
      FROM dji_parcels
    `);
    console.log(JSON.stringify(r1.rows[0], null, 2));

    console.log('\n=== 2. Distribución por tipo de campo y drone ===');
    const r2 = await client.query(`
      SELECT
        field_type,
        is_orchard,
        drone_model_name,
        count(*) AS n,
        round(avg(spray_area_m2)::numeric, 2) AS avg_spray_m2,
        round(avg(declared_area_ha)::numeric, 4) AS avg_declared_ha
      FROM dji_parcels
      GROUP BY field_type, is_orchard, drone_model_name
      ORDER BY n DESC
    `);
    for (const row of r2.rows) {
      console.log(`  ${row.field_type} | is_orchard=${row.is_orchard} | drone=${row.drone_model_name} | n=${row.n} | avg_spray=${row.avg_spray_m2}m² | avg_declared=${row.avg_declared_ha}ha`);
    }

    console.log('\n=== 3. Validación de geometrías ===');
    const r3 = await client.query(`
      SELECT
        count(*) AS total,
        count(CASE WHEN ST_IsValid(spray_geom) THEN 1 END) AS valid_geom,
        count(CASE WHEN NOT ST_IsValid(spray_geom) THEN 1 END) AS invalid_geom,
        min(ST_NPoints(spray_geom)) AS min_vertices,
        max(ST_NPoints(spray_geom)) AS max_vertices,
        round(avg(ST_Area(spray_geom::geography))::numeric, 2) AS avg_area_m2_geo
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
    `);
    console.log(JSON.stringify(r3.rows[0], null, 2));

    console.log('\n=== 4. Join: parcels con field_catalog matcheado por nombre ===');
    const r4 = await client.query(`
      SELECT
        count(*) AS total_parcels,
        count(fc.id) AS matched_field_catalog,
        count(*) - count(fc.id) AS unmatched
      FROM dji_parcels p
      LEFT JOIN dji_field_catalog fc
        ON p.batch_id = fc.batch_id
        AND LOWER(TRIM(COALESCE(p.land_name, ''))) = LOWER(TRIM(COALESCE(fc.field_name, '')))
    `);
    console.log(JSON.stringify(r4.rows[0], null, 2));

    console.log('\n=== 5. Join: parcels con drone_model_name resuelto ===');
    const r5 = await client.query(`
      SELECT
        count(*) AS total,
        count(drone_model_name) AS resolved,
        count(*) - count(drone_model_name) AS unresolved
      FROM dji_parcels
    `);
    console.log(JSON.stringify(r5.rows[0], null, 2));

    console.log('\n=== 6. Top 5 parcelas por spray_area ===');
    const r6 = await client.query(`
      SELECT
        external_id,
        land_name,
        field_type,
        drone_model_name,
        round(spray_area_m2::numeric, 2) AS spray_m2,
        round(declared_area_ha::numeric, 4) AS declared_ha,
        waypoint_count
      FROM dji_parcels
      WHERE spray_area_m2 > 0
      ORDER BY spray_area_m2 DESC
      LIMIT 5
    `);
    for (const row of r6.rows) {
      console.log(`  ${row.land_name || row.external_id} | ${row.field_type} | ${row.drone_model_name || '?'} | spray=${row.spray_m2}m² | declared=${row.declared_ha || 'null'}ha | waypoints=${row.waypoint_count ?? 0}`);
    }

    console.log('\n=== 7. Parcelas con NULL en campos críticos ===');
    const r7 = await client.query(`
      SELECT
        count(CASE WHEN spray_width_m IS NULL THEN 1 END)         AS null_spray_width,
        count(CASE WHEN work_speed_mps IS NULL THEN 1 END)        AS null_work_speed,
        count(CASE WHEN radar_height_m IS NULL THEN 1 END)        AS null_radar_height,
        count(CASE WHEN spray_area_m2 IS NULL OR spray_area_m2 = 0 THEN 1 END) AS null_or_zero_spray_area,
        count(CASE WHEN field_type NOT IN ('Farmland','Orchards') THEN 1 END) AS unknown_field_type
      FROM dji_parcels
    `);
    console.log(JSON.stringify(r7.rows[0], null, 2));

    console.log('\n=== 8. Muestra de geometrías (1 polígono + 1 waypoint) ===');
    const r8a = await client.query(`
      SELECT land_name, ST_AsGeoJSON(spray_geom)::json AS geom
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
      LIMIT 1
    `);
    if (r8a.rows[0]) {
      console.log(`  spray_geom sample (${r8a.rows[0].land_name}):`);
      console.log(`  type=${r8a.rows[0].geom.type}, ${r8a.rows[0].geom.coordinates[0].length} vértices`);
    }
    const r8b = await client.query(`
      SELECT land_name, ST_AsGeoJSON(waypoints)::json AS wp, waypoint_count
      FROM dji_parcels
      WHERE waypoints IS NOT NULL
      ORDER BY waypoint_count DESC
      LIMIT 1
    `);
    if (r8b.rows[0]) {
      console.log(`  waypoints sample (${r8b.rows[0].land_name}): ${r8b.rows[0].waypoint_count} puntos, type=${r8b.rows[0].wp.type}`);
    }
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
