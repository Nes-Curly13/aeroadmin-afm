// CLI: upsert de vuelos per-flight (de DJI flight_records?page=N) a dji_flights.
//
// Idempotente: corre N veces = mismo resultado. Usa el unique constraint
// (flight_id, source) en dji_flights para UPSERT por flight ID.
//
// NO asigna parcel_id (eso lo hace spatial-join-flights-parcels.js en un
// paso posterior — necesitamos dji_parcels cargada primero).
//
// Uso:
//   node scripts/upsert-flights-from-djiag.js
//   node scripts/upsert-flights-from-djiag.js --in djiag_exports/perflight_records.json
//
// Variables de entorno (.env.local):
//   DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  parsePerFlightFile,
  UPSERT_SQL,
  paramsToPgArray,
} = require('../lib/djiag-flights-fetcher');

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

async function upsertFlights(client, flights) {
  let upserted = 0;
  let errors = 0;
  for (const f of flights) {
    if (!f.flightId) {
      errors += 1;
      console.warn(`  [skip] flight sin id`);
      continue;
    }
    if (!f.startAt || !f.endAt) {
      errors += 1;
      console.warn(`  [skip] flight ${f.flightId} sin start/end timestamp`);
      continue;
    }
    try {
      await client.query(UPSERT_SQL, paramsToPgArray(f));
      upserted += 1;
    } catch (err) {
      errors += 1;
      console.error(`  [error] flight ${f.flightId}: ${err.message.slice(0, 160)}`);
    }
  }
  return { upserted, errors };
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const inPath = inIdx >= 0
    ? path.resolve(args[inIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'perflight_records.json');

  if (!fs.existsSync(inPath)) {
    throw new Error(`No se encontro ${inPath}. Corré primero: node scrape_djiag_perflight.js`);
  }

  const file = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const parsed = parsePerFlightFile(file);
  const flights = parsed.flights;

  if (flights.length === 0) {
    throw new Error(`${inPath} no contiene flights.`);
  }

  console.log(`[upsert-flights] ${flights.length} flights desde ${path.relative(process.cwd(), inPath)}`);
  console.log(`  meta: ${JSON.stringify(parsed.meta)}`);

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = await upsertFlights(client, flights);
    await client.query('COMMIT');
    console.log(
      `[upsert-flights] OK: ${stats.upserted} upserts, ${stats.errors} errors`
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
    console.error('[upsert-flights] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main, upsertFlights };