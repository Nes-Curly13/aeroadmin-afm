// Diagnóstico: ¿se pueden matchear las 30 fumigaciones huérfanas con
// sus flights via ST_Contains?
const fs = require('fs');
const path = require('path');
const { Client, Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadLocalEnv();

const c = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await c.connect();
  try {
    // 1) Schema de dji_flights — qué columnas tiene para coordenadas
    const cols = await c.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dji_flights'
        AND (column_name ILIKE '%lat%' OR column_name ILIKE '%lng%'
             OR column_name ILIKE '%lon%' OR column_name ILIKE '%point%'
             OR column_name ILIKE '%coord%' OR column_name ILIKE '%geometry%')
      ORDER BY column_name
    `);
    console.log('Columnas de coordenadas en dji_flights:');
    cols.rows.forEach((r) => console.log(' ', r.column_name, r.data_type));

    // 2) Para las 30 fumigaciones huérfanas, ¿cuántos flights tienen asociados?
    const orphanFlights = await c.query(`
      SELECT
        fum.id AS fumigation_id,
        fum.fumigation_date,
        cardinality(fum.flight_ids) AS n_flights,
        -- Coordenadas promedio de los flights (centroide)
        AVG(f.lat) FILTER (WHERE f.lat IS NOT NULL) AS avg_lat,
        AVG(f.lng) FILTER (WHERE f.lng IS NOT NULL) AS avg_lng
      FROM dji_fumigations fum
      JOIN dji_flights f ON f.id = ANY(fum.flight_ids)
      WHERE fum.parcel_id IS NULL
        AND fum.deleted_at IS NULL
      GROUP BY fum.id, fum.fumigation_date
      ORDER BY fum.fumigation_date DESC
    `);
    console.log('\nFumigaciones huérfanas con sus flights (lat/lng promedio):');
    if (orphanFlights.rows.length === 0) {
      console.log('  (ninguna huérfana con flight_ids populado)');
    }
    let withCoords = 0;
    let withoutCoords = 0;
    orphanFlights.rows.forEach((r) => {
      const hasCoords = r.avg_lat !== null && r.avg_lng !== null;
      if (hasCoords) withCoords += 1; else withoutCoords += 1;
      console.log(
        ' ', r.fumigation_id, r.fumigation_date?.toISOString().slice(0, 10),
        'flights=' + r.n_flights,
        hasCoords ? `(${Number(r.avg_lat).toFixed(4)}, ${Number(r.avg_lng).toFixed(4)})` : '(sin coords)'
      );
    });
    console.log(`\nResumen: ${withCoords} con coords, ${withoutCoords} sin coords`);

    // 3) Para las que tienen coords, ¿cuántas caen dentro de alguna parcela?
    if (withCoords > 0) {
      const matchable = await c.query(`
        WITH orphan_centroids AS (
          SELECT
            fum.id AS fumigation_id,
            AVG(f.lat)::float8 AS lat,
            AVG(f.lng)::float8 AS lng
          FROM dji_fumigations fum
          JOIN dji_flights f ON f.id = ANY(fum.flight_ids)
          WHERE fum.parcel_id IS NULL
            AND fum.deleted_at IS NULL
            AND f.lat IS NOT NULL
            AND f.lng IS NOT NULL
          GROUP BY fum.id
        ),
        -- Convertir el centroide a point en SRID 4686 (Bogota)
        orphan_points AS (
          SELECT
            fumigation_id,
            ST_SetSRID(ST_MakePoint(lng, lat), 4686) AS geom
          FROM orphan_centroids
        )
        SELECT
          op.fumigation_id,
          -- Encontrar la parcela más cercana (no necesariamente ST_Contains
          -- porque las coords pueden caer en un borde)
          p.id AS closest_parcel_id,
          p.land_name,
          ST_Distance(
            p.spray_geom::geography,
            op.geom::geography
          ) AS distance_m
        FROM orphan_points op
        CROSS JOIN LATERAL (
          SELECT id, land_name, spray_geom
          FROM dji_parcels
          WHERE spray_geom IS NOT NULL
          ORDER BY spray_geom <-> op.geom
          LIMIT 1
        ) p
        ORDER BY distance_m
        LIMIT 50
      `);
      console.log('\nMatch espacial de huérfanas con la parcela más cercana:');
      const closeEnough = matchable.rows.filter((r) => Number(r.distance_m) < 1000);
      const tooFar = matchable.rows.filter((r) => Number(r.distance_m) >= 1000);
      console.log(`  ${closeEnough.length} dentro de 1 km`);
      console.log(`  ${tooFar.length} a más de 1 km (probablemente huérfanas reales)`);
      console.log('\n  Top 5 más cercanas:');
      matchable.rows.slice(0, 5).forEach((r) =>
        console.log('   ', r.fumigation_id, '→ parcel', r.closest_parcel_id, r.land_name, `${Number(r.distance_m).toFixed(0)}m`)
      );
      if (closeEnough.length > 0) {
        console.log('\n  Top 5 dentro de 1 km:');
        closeEnough.slice(0, 5).forEach((r) =>
          console.log('   ', r.fumigation_id, '→ parcel', r.closest_parcel_id, r.land_name, `${Number(r.distance_m).toFixed(0)}m`)
        );
      }
    }
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await c.end();
  }
})();
