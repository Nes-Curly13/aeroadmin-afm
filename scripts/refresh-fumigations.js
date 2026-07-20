// CLI: refresca los datos derivados de fumigaciones sin re-scrapear DJI.
//
// Por qué existe:
//   - audit ui-ux-2026-07 §9: la BD se actualizaba solo cuando se corría
//     el backfill a mano, dejando el panel con data stale 24-48h.
//   - Este script es el wrapper que ejecuta los 2 pasos de recompute que
//     dependen SOLO de dji_flights (yaculated) y dji_fumigations
//     (aggregated), sin tocar DJI:
//
//       1. backfill-fumigations-from-flights:
//          re-agrupa dji_flights por (parcel_id, fecha local) y
//          re-inserta en dji_fumigations con source='import'.
//          (Idempotente: borra source='import' + parcel_id NOT NULL antes
//          de re-insertar.)
//
//       2. update-fumigation-schedule:
//          re-calcula dji_fumigation_schedule.last_fumigation_date +
//          next_due_date desde dji_fumigations.
//
//   - El scraper DJI (pasos 1-5 de run-pipeline.js) se mantiene fuera
//     de este cron: requiere browser/Playwright + credenciales + tiempo
//     (~30min). Eso lo corre el operador a mano o el pipeline completo.
//
// Idempotente: correr este script N veces = mismo resultado.
//
// Uso:
//   node scripts/refresh-fumigations.js
//
// Variables de entorno (.env.local):
//   DATABASE_URL (o DATABASE_URL_DIRECT)
//
// Exit codes:
//   0 = OK
//   1 = error de DB o query

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { backfillFumigationsFromFlights } = require('./backfill-fumigations-from-flights.js');
const { updateSchedule } = require('./update-fumigation-schedule.js');

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
    max: 3,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

/**
 * Refresca fumigaciones y schedule. Retorna stats.
 *
 * Estrategia:
 *   1. BEGIN tx
 *   2. backfillFumigationsFromFlights (re-agrupa flights → fumigations)
 *   3. updateSchedule (re-calcula last_fumigation_date + next_due_date)
 *   4. COMMIT
 *
 * Si cualquier paso falla → ROLLBACK y la excepción propaga. main()
 * la atrapa y hace process.exit(1).
 *
 * `deps` permite inyectar los pasos para tests. En producción se usan
 * los defaults (los módulos reales). Ver tests/refresh-fumigations.test.ts.
 */
async function refreshFumigations(client, deps = {}) {
  const backfill = deps.backfillFumigationsFromFlights ?? backfillFumigationsFromFlights;
  const update = deps.updateSchedule ?? updateSchedule;

  const startedAt = Date.now();
  const backfillStats = await backfill(client);
  const scheduleRows = await update(client);

  return {
    backfilled: backfillStats.inserted,
    scheduleUpdated: scheduleRows.length,
    durationMs: Date.now() - startedAt
  };
}

async function main() {
  loadLocalEnv();
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('[refresh-fumigations] starting refresh...');
    const stats = await refreshFumigations(client);
    await client.query('COMMIT');
    console.log(
      `[refresh-fumigations] done: ${stats.backfilled} fumigations updated, `
      + `${stats.scheduleUpdated} schedule rows, took ${stats.durationMs}ms`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[refresh-fumigations] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, refreshFumigations };
