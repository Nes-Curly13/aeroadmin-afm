// CLI: upsert de lands (API de DJI) a dji_parcels.
//
// Idempotente: corre N veces = mismo resultado. Crea un batch nuevo cada
// corrida para mantener trazabilidad de cuándo se fetcheó la data.
//
// NO toca las tablas del importer legacy (dji_daily_summaries,
// dji_field_catalog, dji_land_assets). Solo escribe a dji_parcels.
// Las columnas de parameter.json que ya estén en la fila se preservan
// (el ON CONFLICT solo actualiza las columnas API).
//
// Uso:
//   node scripts/upsert-lands-from-djiag.js
//   node scripts/upsert-lands-from-djiag.js --in djiag_exports/lands.json
//
// Output:
//   - 1 batch en dji_import_batches
//   - N upserts en dji_parcels (uno por land)
//   - log con count de inserted vs updated
//
// Variables de entorno (.env.local):
//   DATABASE_URL, DJIAG_EMAIL, DJIAG_PASSWORD (este último no es necesario
//   para el upsert — solo para el fetcher)

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const {
  landToParcelParams,
  paramsToPgArray,
  UPSERT_SQL
} = require('../lib/djiag-lands-to-parcels');

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

async function upsertLands(client, batchId, lands) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const land of lands) {
    if (!land.externalId) {
      skipped += 1;
      console.warn(`  [skip] land sin externalId: ${land.name || land.uuid || '?'}`);
      continue;
    }
    const p = landToParcelParams(land);
    try {
      const result = await client.query(UPSERT_SQL, paramsToPgArray(batchId, p));
      // pg devuelve rowCount; en ON CONFLICT UPDATE rowCount=1 (updated) o rowCount=0 (no-op si nada cambió)
      // Para distinguir insert vs update exacto necesitaríamos RETURNING (xmax = 0) trick.
      // Por simplicidad contamos como "touched" cualquier rowCount>0.
      if (result.rowCount > 0) {
        inserted += 1; // aproximación: tanto INSERT como UPDATE cuentan acá
      }
    } catch (err) {
      errors += 1;
      console.error(`  [error] ${land.externalId}: ${err.message.slice(0, 120)}`);
    }
  }

  return { inserted, skipped, errors };
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--in');
  const inPath = inIdx >= 0
    ? path.resolve(args[inIdx + 1])
    : path.join(process.cwd(), 'djiag_exports', 'lands.json');

  if (!fs.existsSync(inPath)) {
    throw new Error(`No se encontró ${inPath}. Corré primero: npm run fetch:djiag:lands`);
  }

  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const lands = Array.isArray(data) ? data : (data.lands ?? []);
  if (!Array.isArray(lands) || lands.length === 0) {
    throw new Error(`${inPath} no contiene lands.`);
  }

  console.log(`[upsert-lands] ${lands.length} lands desde ${path.relative(process.cwd(), inPath)}`);

  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const batchResult = await client.query(
      "INSERT INTO dji_import_batches (source) VALUES ('djiscraper-api') RETURNING id"
    );
    const batchId = batchResult.rows[0].id;
    console.log(`[upsert-lands] batch_id = ${batchId}`);

    const stats = await upsertLands(client, batchId, lands);

    await client.query('COMMIT');
    console.log(
      `[upsert-lands] OK: ${stats.inserted} upserts, ${stats.skipped} skipped, ${stats.errors} errors`
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
    console.error('[upsert-lands] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main, upsertLands };
