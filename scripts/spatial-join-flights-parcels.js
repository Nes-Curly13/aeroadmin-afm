// CLI: spatial join entre dji_flights y dji_parcels.
//
// Para cada dji_flights row con parcel_id IS NULL y lng/lat presentes,
// encuentra el dji_parcels mas cercano dentro de una tolerancia y asigna
// parcel_id. Usa el GIST index sobre dji_parcels.spray_geom (4326).
//
// Algoritmo:
//   1. Para cada flight sin parcela:
//      a. Construye un Point geometry desde (lng, lat) en SRID 4326
//      b. Busca el parcel cuyo spray_geom contiene el point, o — si no
//         hay match exacto — el parcel mas cercano dentro de 50m.
//      c. UPDATE dji_flights SET parcel_id = ... WHERE flight_id = ...
//   2. Imprime stats: matched / unmatched / skipped.
//
// Uso:
//   node scripts/spatial-join-flights-parcels.js
//   node scripts/spatial-join-flights-parcels.js --tolerance 100   # metros
//
// Variables de entorno (.env.local):
//   DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === 'true';
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

/**
 * Spatial join. Devuelve stats.
 *
 * Estrategia: single SQL query con LATERAL join que elige el mejor parcel
 * por cada flight. Usa ST_DWithin como fallback si ST_Within no matchea.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} toleranceMeters - distancia maxima al borde de la parcela
 * @returns {Promise<{ matched: number, unmatched: number }>}
 */
async function spatialJoinFlights(client, toleranceMeters = 50) {
  const sql = `
    WITH candidates AS (
      SELECT
        f.flight_id,
        p.id AS parcel_id,
        p.land_name,
        p.field_type,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
          p.spray_geom::geography
        ) AS distance_m
      FROM dji_flights f
      LEFT JOIN LATERAL (
        SELECT id, land_name, field_type, spray_geom
        FROM dji_parcels
        WHERE spray_geom IS NOT NULL
          AND (
            ST_Within(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326),
              spray_geom
            )
            OR ST_DWithin(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
              spray_geom::geography,
              $1
            )
          )
        ORDER BY
          CASE WHEN ST_Within(
            ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326),
            spray_geom
          ) THEN 0 ELSE 1 END,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
            spray_geom::geography
          )
        LIMIT 1
      ) p ON true
      WHERE f.parcel_id IS NULL
        AND f.lng IS NOT NULL
        AND f.lat IS NOT NULL
    )
    UPDATE dji_flights f
    SET parcel_id = c.parcel_id,
        notes = f.notes || jsonb_build_object(
          'spatial_join', jsonb_build_object(
            'parcel_id', c.parcel_id,
            'land_name', c.land_name,
            'field_type', c.field_type,
            'distance_m', c.distance_m,
            'tolerance_m', $1,
            'joined_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          )
        )
    FROM candidates c
    WHERE f.flight_id = c.flight_id
      AND c.parcel_id IS NOT NULL
    RETURNING f.flight_id
  `;
  const result = await client.query(sql, [toleranceMeters]);
  const matched = result.rowCount ?? 0;

  // Count flights que quedaron sin match (tienen lng/lat pero no parcel_id)
  const unmatchedRes = await client.query(`
    SELECT COUNT(*)::int AS c
    FROM dji_flights
    WHERE parcel_id IS NULL
      AND lng IS NOT NULL
      AND lat IS NOT NULL
  `);
  const unmatched = unmatchedRes.rows[0].c;

  return { matched, unmatched };
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const tolIdx = args.indexOf('--tolerance');
  const tolerance = tolIdx >= 0 ? Number(args[tolIdx + 1]) || 50 : 50;

  console.log(`[spatial-join] tolerancia: ${tolerance}m`);

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = await spatialJoinFlights(client, tolerance);
    await client.query('COMMIT');
    console.log(
      `[spatial-join] OK: ${stats.matched} flights matched, ${stats.unmatched} flights aun sin parcela`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[spatial-join] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main, spatialJoinFlights };