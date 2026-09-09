#!/usr/bin/env node
// CLI: upsert de vuelos per-flight (batch multi-row VALUES) → dji_flights.
//
// Por que existe:
//   scripts/upsert-flights-from-djiag.js hace 1 INSERT por flight, lo que
//   para 10k+ flights es ~30-60min en Supabase free tier. Esta version
//   batchea N flights por INSERT (multi-row VALUES), reduciendo los
//   round-trips de 10k a ~21 (con batchSize=500). En Supabase free tier
//   eso baja el tiempo total a 1-3 min.
//
// Idempotente: usa ON CONFLICT (flight_id, source) DO UPDATE.
//
// NO asigna parcel_id (eso lo hace el spatial-join en un paso posterior).
//
// Uso:
//   node scripts/upsert-flights-batch.js [--in <perflight.json>] [--batch-size 500]

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  parsePerFlightFile,
  paramsToPgArray,
} = require('../lib/djiag-flights-fetcher');

const DEFAULT_BATCH_SIZE = 500;
const COL_COUNT = 24; // columnas por flight en el UPSERT

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
  const args = { in: null, batchSize: DEFAULT_BATCH_SIZE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in' && argv[i + 1]) args.in = argv[++i];
    else if (argv[i] === '--batch-size' && argv[i + 1]) args.batchSize = Number(argv[++i]);
  }
  return args;
}

function buildBatchInsertSql(flightCount) {
  // Genera SQL con flightCount grupos de 24 placeholders.
  // Estructura: VALUES ($1,$2,...,$24), ($25,...,$48), ...
  const groups = [];
  for (let i = 0; i < flightCount; i++) {
    const offset = i * COL_COUNT;
    const placeholders = Array.from({ length: COL_COUNT }, (_, k) => `$${offset + k + 1}`).join(', ');
    groups.push(`(${placeholders})`);
  }
  return `
INSERT INTO dji_flights (
  flight_id, parcel_id, drone_serial, drone_nickname,
  pilot_name, flyer_name, district, location,
  start_at, end_at, duration_seconds,
  area_m2, spray_usage_ml, work_speed_m_s, spray_width_m, radar_height_m,
  manual_mode, mode_name, create_date,
  lng, lat, notes, captured_at, source
) VALUES ${groups.join(', ')}
ON CONFLICT (flight_id, source) DO UPDATE SET
  parcel_id        = EXCLUDED.parcel_id,
  drone_serial     = EXCLUDED.drone_serial,
  drone_nickname   = EXCLUDED.drone_nickname,
  pilot_name       = EXCLUDED.pilot_name,
  flyer_name       = EXCLUDED.flyer_name,
  district         = EXCLUDED.district,
  location         = EXCLUDED.location,
  start_at         = EXCLUDED.start_at,
  end_at           = EXCLUDED.end_at,
  duration_seconds = EXCLUDED.duration_seconds,
  area_m2          = EXCLUDED.area_m2,
  spray_usage_ml   = EXCLUDED.spray_usage_ml,
  work_speed_m_s   = EXCLUDED.work_speed_m_s,
  spray_width_m    = EXCLUDED.spray_width_m,
  radar_height_m   = EXCLUDED.radar_height_m,
  manual_mode      = EXCLUDED.manual_mode,
  mode_name        = EXCLUDED.mode_name,
  create_date      = EXCLUDED.create_date,
  lng              = EXCLUDED.lng,
  lat              = EXCLUDED.lat,
  notes            = EXCLUDED.notes,
  captured_at      = EXCLUDED.captured_at
`;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const batchSize = args.batchSize;
  if (!Number.isFinite(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error(`--batch-size debe estar entre 1 y 1000 (recibido: ${batchSize})`);
  }

  const cwd = process.cwd();
  const inPath = args.in ? path.resolve(args.in) : path.join(cwd, 'djiag_exports', 'perflight_records.json');
  if (!fs.existsSync(inPath)) throw new Error(`No existe ${inPath}`);

  const file = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const parsed = parsePerFlightFile(file);
  const flights = parsed.flights;
  if (flights.length === 0) throw new Error(`${inPath} no contiene flights.`);
  console.log(`[upsert-flights-batch] ${flights.length} flights desde ${path.relative(cwd, inPath)}`);
  console.log(`  batch size: ${batchSize} (${Math.ceil(flights.length / batchSize)} batches)`);
  console.log(`  meta: ${JSON.stringify(parsed.meta)}`);

  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 60_000,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  let totalUpserted = 0;
  let totalErrors = 0;
  const t0 = Date.now();
  try {
    // Precomputamos `captured_at` a NOW() (mismo valor para todo el batch).
    const capturedAt = new Date();
    const source = 'djiag';

    for (let i = 0; i < flights.length; i += batchSize) {
      const batch = flights.slice(i, i + batchSize);
      const validBatch = batch.filter((f) => f.flightId && f.startAt && f.endAt);
      const skippedInBatch = batch.length - validBatch.length;
      if (skippedInBatch > 0) totalErrors += skippedInBatch;

      if (validBatch.length === 0) {
        console.warn(`  [batch ${Math.floor(i / batchSize) + 1}] 0 valid flights, skip`);
        continue;
      }

      const sql = buildBatchInsertSql(validBatch.length);
      const params = [];
      for (const f of validBatch) {
        const row = paramsToPgArray(f);
        // Sobrescribimos captured_at y source para que sean consistentes.
        row[22] = capturedAt; // $23 captured_at
        row[23] = source;     // $24 source
        params.push(...row);
      }

      const tBatch = Date.now();
      try {
        const res = await client.query(sql, params);
        const dt = Date.now() - tBatch;
        totalUpserted += validBatch.length;
        const inserted = res.rowCount ?? validBatch.length;
        console.log(`  [batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(flights.length / batchSize)}] ${validBatch.length} rows in ${dt}ms (rowCount=${inserted})`);
      } catch (err) {
        totalErrors += validBatch.length;
        console.error(`  [batch ${Math.floor(i / batchSize) + 1}] ERROR: ${err.message.slice(0, 200)}`);
        // No propagamos — el siguiente batch puede funcionar.
      }
    }

    const dt = Date.now() - t0;
    console.log(`\n[upsert-flights-batch] OK: ${totalUpserted} upserts, ${totalErrors} errors, total ${(dt / 1000).toFixed(1)}s`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[upsert-flights-batch] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main, buildBatchInsertSql };
