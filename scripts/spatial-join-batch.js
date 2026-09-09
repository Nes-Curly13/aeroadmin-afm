#!/usr/bin/env node
// CLI: spatial join por chunks para evitar statement timeout en Supabase.
//
// El script original (scripts/spatial-join-flights-parcels.js) hace UN solo
// UPDATE con un CTE-LATERAL que matchea TODOS los flights a la vez. Para
// 10k+ flights + GIST index + LATERAL, supera el statement_timeout default
// de Supabase free tier (~10-30s).
//
// Esta version procesa los flights sin parcel_id en chunks de N rows
// (default 1000). Cada chunk es un UPDATE independiente, dentro del timeout.
//
// Uso:
//   node scripts/spatial-join-batch.js [--tolerance 100] [--chunk 1000]

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
  const args = { tolerance: 100, chunk: 1000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tolerance' && argv[i + 1]) args.tolerance = Number(argv[++i]);
    else if (argv[i] === '--chunk' && argv[i + 1]) args.chunk = Number(argv[++i]);
  }
  return args;
}

async function spatialJoinChunk(client, flightIds, toleranceMeters) {
  // Por cada flight_id en flightIds, encuentra el parcel más cercano y asigna parcel_id.
  // Más simple que el LATERAL join: un JOIN directo con ST_Distance.
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
        ) AS distance_m,
        ROW_NUMBER() OVER (
          PARTITION BY f.flight_id
          ORDER BY
            CASE WHEN ST_Within(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326),
              p.spray_geom
            ) THEN 0 ELSE 1 END,
            ST_Distance(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
              p.spray_geom::geography
            )
        ) AS rn
      FROM dji_flights f
      JOIN dji_parcels p
        ON p.spray_geom IS NOT NULL
       AND (ST_Within(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326),
              p.spray_geom
            )
            OR ST_DWithin(
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
              p.spray_geom::geography,
              $2
            ))
      WHERE f.parcel_id IS NULL
        AND f.lng IS NOT NULL
        AND f.lat IS NOT NULL
        AND f.flight_id = ANY($1::bigint[])
    )
    UPDATE dji_flights f
    SET parcel_id = c.parcel_id,
        notes = f.notes || jsonb_build_object(
          'spatial_join', jsonb_build_object(
            'parcel_id', c.parcel_id,
            'land_name', c.land_name,
            'field_type', c.field_type,
            'distance_m', c.distance_m,
            'tolerance_m', $2,
            'joined_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          )
        )
    FROM candidates c
    WHERE f.flight_id = c.flight_id
      AND c.rn = 1
    RETURNING f.flight_id
  `;
  const r = await client.query(sql, [flightIds, toleranceMeters]);
  return r.rowCount ?? 0;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(argv_extra_to_args(process.argv.slice(2)));

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
  const t0 = Date.now();
  try {
    // Sube el statement_timeout a 5 min para que cada chunk tenga aire.
    await client.query("SET statement_timeout = '300s'");

    // Cuenta cuántos flights sin parcel_id.
    const cnt = await client.query(`
      SELECT COUNT(*)::int AS n
      FROM dji_flights
      WHERE parcel_id IS NULL
        AND lng IS NOT NULL
        AND lat IS NOT NULL
    `);
    const total = cnt.rows[0].n;
    console.log(`[spatial-join-batch] tolerance=${args.tolerance}m, chunk=${args.chunk}, total_flights_sin_parcel=${total}`);

    if (total === 0) {
      console.log('  (nada que joinear)');
      return;
    }

    // Trae los flight_id sin parcel_id (no son tantos, podemos hacerlo de una).
    const idsRes = await client.query(`
      SELECT flight_id FROM dji_flights
      WHERE parcel_id IS NULL
        AND lng IS NOT NULL
        AND lat IS NOT NULL
      ORDER BY flight_id
    `);
    const allIds = idsRes.rows.map(r => r.flight_id);
    console.log(`  total ids: ${allIds.length}`);

    let batch = [];
    let chunkNum = 0;
    for (const id of allIds) {
      batch.push(id);
      if (batch.length >= args.chunk) {
        chunkNum += 1;
        const tChunk = Date.now();
        const matched = await spatialJoinChunk(client, batch, args.tolerance);
        totalMatched += matched;
        const dt = Date.now() - tChunk;
        console.log(`  [chunk ${chunkNum}] ${batch.length} flights in ${dt}ms, matched ${matched}`);
        batch = [];
      }
    }
    if (batch.length > 0) {
      chunkNum += 1;
      const tChunk = Date.now();
      const matched = await spatialJoinChunk(client, batch, args.tolerance);
      totalMatched += matched;
      const dt = Date.now() - tChunk;
      console.log(`  [chunk ${chunkNum}] ${batch.length} flights in ${dt}ms, matched ${matched}`);
    }

    const dt = Date.now() - t0;
    console.log(`\n[spatial-join-batch] OK: ${totalMatched} matched, ${(dt / 1000).toFixed(1)}s total`);
  } catch (err) {
    console.error('[spatial-join-batch] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Helpers
function argv_extra_to_args(argv) {
  const args = { tolerance: 100, chunk: 1000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tolerance' && argv[i + 1]) args.tolerance = Number(argv[++i]);
    else if (argv[i] === '--chunk' && argv[i + 1]) args.chunk = Number(argv[++i]);
  }
  return args;
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
