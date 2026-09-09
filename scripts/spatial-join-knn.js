#!/usr/bin/env node
// CLI: spatial join con KNN (mucho más rápido que ST_Within + ST_DWithin).
//
// Por que este script existe:
//   El primer intento (scripts/spatial-join-batch.js) usaba ST_Within +
//   ST_DWithin con cross-join, que es O(n*m) por chunk. Para 1000 flights
//   x 1237 parcels = 1.2M pairs por chunk, ~75s por chunk en Supabase free
//   tier. Y muchos flights quedan a >100m de la parcela más cercana (están
//   en otra zona), así que tolerance=100m no los matchea.
//
// Esta version usa el KNN operator `<->` de PostGIS, que aprovecha el
// GIST index sobre spray_geom y retorna los K vecinos más cercanos en
// O(log n) por flight. Mucho más rápido.
//
// Ademas, hace UPDATE por flight individual (1 query por flight) usando
// el KNN index. Para 6,500 flights a 50ms por flight = 5 min. Más
// confiable que un mega-UPDATE.
//
// Uso:
//   node scripts/spatial-join-knn.js [--tolerance 200] [--limit N]

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

function parseArgs(argv) {
  const args = { tolerance: 200, limit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tolerance' && argv[i + 1]) args.tolerance = Number(argv[++i]);
    else if (argv[i] === '--limit' && argv[i + 1]) args.limit = Number(argv[++i]);
  }
  return args;
}

async function findAndAssignParcel(client, flight, tolerance) {
  // KNN: agarra la parcela más cercana usando GIST index via <-> operator.
  // Si la distancia es <= tolerance, asigna. Si no, no asigna.
  const sql = `
    WITH nearest AS (
      SELECT
        id, land_name, field_type,
        ST_Distance(
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          spray_geom::geography
        ) AS distance_m
      FROM dji_parcels
      WHERE spray_geom IS NOT NULL
      ORDER BY spray_geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1
    )
    UPDATE dji_flights f
    SET parcel_id = n.id,
        notes = f.notes || jsonb_build_object(
          'spatial_join', jsonb_build_object(
            'parcel_id', n.id,
            'land_name', n.land_name,
            'field_type', n.field_type,
            'distance_m', n.distance_m,
            'tolerance_m', $3,
            'joined_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'method', 'knn'
          )
        )
    FROM nearest n
    WHERE f.flight_id = $4
      AND n.distance_m <= $3
    RETURNING f.flight_id
  `;
  const r = await client.query(sql, [flight.lng, flight.lat, tolerance, flight.flight_id]);
  return r.rowCount ?? 0;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 60_000,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  let totalMatched = 0;
  let totalSkipped = 0;
  const t0 = Date.now();
  try {
    // Trae los flights sin parcel (con lng/lat).
    let q = `
      SELECT flight_id, lng, lat
      FROM dji_flights
      WHERE parcel_id IS NULL
        AND lng IS NOT NULL
        AND lat IS NOT NULL
      ORDER BY flight_id
    `;
    const params = [];
    if (args.limit) {
      q += ` LIMIT $1`;
      params.push(args.limit);
    }
    const r = await client.query(q, params);
    const flights = r.rows;
    console.log(`[spatial-join-knn] tolerance=${args.tolerance}m, total_flights=${flights.length}`);

    if (flights.length === 0) {
      console.log('  (nada que joinear)');
      return;
    }

    // Itera 1-a-1 (KNN es rápido con index).
    for (let i = 0; i < flights.length; i++) {
      const f = flights[i];
      const matched = await findAndAssignParcel(client, f, args.tolerance);
      if (matched > 0) totalMatched += 1;
      else totalSkipped += 1;
      // Progress cada 200 flights
      if ((i + 1) % 200 === 0 || i === flights.length - 1) {
        const dt = Date.now() - t0;
        const rate = ((i + 1) / (dt / 1000)).toFixed(1);
        console.log(`  [${i + 1}/${flights.length}] matched=${totalMatched} skipped=${totalSkipped} (${rate} flights/s)`);
      }
    }

    const dt = Date.now() - t0;
    console.log(`\n[spatial-join-knn] OK: ${totalMatched} matched, ${totalSkipped} skipped, ${(dt / 1000).toFixed(1)}s total`);
  } catch (err) {
    console.error('[spatial-join-knn] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
