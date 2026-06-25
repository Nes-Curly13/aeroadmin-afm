// CLI: upsert de fumigaciones aggregate (de DJI aggr_by_day) a dji_fumigations.
//
// Idempotente: corre N veces = mismo resultado. Usa el partial unique index
// `uq_dji_fumigations_aggregate` para UPSERT por (fumigation_date, source)
// donde parcel_id IS NULL.
//
// NO toca las filas de dji_fumigations que tienen parcel_id (esas son del
// importer legacy o futuras fumigaciones per-flight — se preservan).
//
// Uso:
//   node scripts/upsert-fumigations-from-djiag.js
//   node scripts/upsert-fumigations-from-djiag.js --in djiag_exports/fumigations.json
//
// Variables de entorno (.env.local):
//   DATABASE_URL

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  dayToFumigationParams,
  UPSERT_SQL,
  paramsToPgArray
} = require('../lib/djiag-fumigations-fetcher');

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

async function upsertFumigations(client, days) {
  let upserted = 0;
  let errors = 0;
  for (const day of days) {
    if (!day.date) {
      errors += 1;
      console.warn(`  [skip] day sin date: ts=${day.createTimestamp}`);
      continue;
    }
    const p = dayToFumigationParams(day);
    try {
      await client.query(UPSERT_SQL, paramsToPgArray(p));
      upserted += 1;
    } catch (err) {
      errors += 1;
      console.error(`  [error] ${day.date}: ${err.message.slice(0, 120)}`);
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
    : path.join(process.cwd(), 'djiag_exports', 'fumigations.json');

  if (!fs.existsSync(inPath)) {
    throw new Error(`No se encontro ${inPath}. Corré primero: npm run fetch:djiag:fumigations`);
  }

  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const days = Array.isArray(data) ? data : (data.days ?? []);
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error(`${inPath} no contiene days.`);
  }

  console.log(`[upsert-fumigations] ${days.length} dias desde ${path.relative(process.cwd(), inPath)}`);

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stats = await upsertFumigations(client, days);
    await client.query('COMMIT');
    console.log(
      `[upsert-fumigations] OK: ${stats.upserted} upserts, ${stats.errors} errors`
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
    console.error('[upsert-fumigations] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main, upsertFumigations };
