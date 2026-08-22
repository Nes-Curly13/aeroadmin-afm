// CLI: upsert de fumigaciones aggregate (de DJI aggr_by_day) a dji_fumigations.
//
// Idempotente: corre N veces = mismo resultado. Usa el partial unique index
// `uq_dji_fumigations_aggregate` para UPSERT por (fumigation_date, source)
// donde parcel_id IS NULL.
//
// NO toca las filas de dji_fumigations que tienen parcel_id (esas son del
// importer legacy o futuras fumigaciones per-flight — se preservan).
//
// Audit log (sprint feat/pipeline-audit-integration, 2026-08-22):
//   Cuando la UPSERT INSERTA una fila nueva (no un UPDATE por ON CONFLICT),
//   registra un evento 'created' en `fumigation_audit_log` con
//   actor_email = `recorded_by` de la fila (fallback 'system@dji-import'
//   si es NULL). Re-correr el script N veces NO duplica entradas en el
//   audit log — usamos el truco de PG `(xmax = 0) AS inserted` para
//   distinguir INSERT vs UPDATE.
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

/**
 * Actor de fallback para fumigaciones scrapeadas con `recorded_by` NULL.
 * Coincide con el que usa `scripts/backfill-audit-log.js` y la convención
 * del sprint de audit log (2026-08-15).
 */
const ACTOR_SYSTEM_IMPORT = 'system@dji-import';

/**
 * Campos del snapshot que persisten en `fumigation_audit_log.changes->fields`
 * para el evento 'created'. Coincide con `FUMIGATION_SNAPSHOT_FIELDS` de
 * `lib/fumigation-audit.ts` (mismo shape que el endpoint POST manual).
 *
 * NO incluye `recorded_at` / `source` / `flight_ids` (provenance
 * inmutable) ni `deleted_at` (relevante solo para 'deleted').
 */
const FUMIGATION_SNAPSHOT_FIELDS = [
  'parcel_id',
  'fumigation_date',
  'product_used',
  'dose_l_per_ha',
  'area_fumigated_m2',
  'drone_code_used',
  'duration_minutes',
  'notes',
  'product_registered_ica',
  'pilot_license',
  'category_id'
];

const SQL_INSERT_AUDIT = `
  INSERT INTO fumigation_audit_log
    (fumigation_id, action, actor_email, changes)
  VALUES ($1, $2, $3, $4::jsonb)
`;

/**
 * Construye el payload `changes` para un evento 'created'. Mismo shape
 * que `fumigationAuditSnapshot` en `lib/fumigation-audit.ts`: un objeto
 * `{ fields: { ... } }` con los campos editables/visibles de la fumigación.
 *
 * Mantenido local (no importado de `lib/fumigation-audit.ts`) porque los
 * scripts son CJS y `lib/fumigation-audit.ts` usa el path alias `@/`
 * de Next.js. Si la shape cambia en `lib/fumigation-audit.ts`, actualizar
 * acá también.
 *
 * @param {Record<string, unknown>} row — fila de dji_fumigations (del RETURNING)
 * @returns {Record<string, unknown>}
 */
function buildCreatedSnapshot(row) {
  const fields = {};
  for (const k of FUMIGATION_SNAPSHOT_FIELDS) {
    fields[k] = row[k] == null ? null : row[k];
  }
  return { fields };
}

/**
 * Registra un evento 'created' en `fumigation_audit_log` para una
 * fumigación recién insertada por el upsert. Equivalente a
 * `recordFumigationCreate(fumigation, actorEmail)` de
 * `lib/fumigation-audit.ts` (misma lógica, mismo shape de payload).
 *
 * Por qué existe acá (y no se importa del módulo TS):
 *   - Los scripts son CJS y `lib/fumigation-audit.ts` usa `@/api/repositories`
 *     con el path alias de Next.js (no se puede `require()` directo).
 *   - Mantenemos el helper chico y local — solo necesita hacer un INSERT
 *     con un snapshot de los campos.
 *
 * Fire-and-forget style: si falla el INSERT de audit, lo logueamos
 * pero NO rompemos el pipeline (la fumigación ya quedó persistida).
 * Mismo trade-off que el endpoint admin (ver `lib/fumigation-audit.ts:117`).
 *
 * Devuelve `true` si insertó, `false` si falló (para que el caller
 * pueda contar fallos sin propagar el error).
 *
 * @param {import('pg').PoolClient} client — mismo client del upsert
 * @param {Record<string, unknown>} row — fila de dji_fumigations (RETURNING)
 * @param {string} actorEmail — email del actor; cae a 'system@dji-import' si row.recorded_by es NULL
 * @returns {Promise<boolean>}
 */
async function recordFumigationCreate(client, row, actorEmail) {
  const actor = actorEmail || ACTOR_SYSTEM_IMPORT;
  const changes = buildCreatedSnapshot(row);
  try {
    await client.query(SQL_INSERT_AUDIT, [
      row.id,
      'created',
      actor,
      JSON.stringify(changes)
    ]);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[upsert-fumigations] failed to record 'created' audit for fumigation_id=${row.id} (la fumigación ya quedó persistida):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function upsertFumigations(client, days) {
  let upserted = 0;
  let inserted = 0;
  let updated = 0;
  let auditInserted = 0;
  let auditFailed = 0;
  let errors = 0;
  for (const day of days) {
    if (!day.date) {
      errors += 1;
      console.warn(`  [skip] day sin date: ts=${day.createTimestamp}`);
      continue;
    }
    const p = dayToFumigationParams(day);
    try {
      const res = await client.query(UPSERT_SQL, paramsToPgArray(p));
      upserted += 1;
      const row = res.rows[0];
      if (!row) {
        // Caso raro: el UPSERT no devolvió row. Lo contamos como error
        // pero seguimos — no podemos registrar audit sin id.
        errors += 1;
        console.warn(`  [warn] ${day.date}: UPSERT no devolvió RETURNING row`);
        continue;
      }
      // PG: (xmax = 0) = true cuando la fila se INSERTó. False en UPDATE
      // por ON CONFLICT. Eso distingue "fumigación nueva" (registrar
      // audit) de "ya existía con esos keys" (no registrar — la fumigación
      // histórica ya tiene su propio evento, vía backfill-audit-log).
      if (row.inserted) {
        inserted += 1;
        const actor = row.recorded_by || ACTOR_SYSTEM_IMPORT;
        const ok = await recordFumigationCreate(client, row, actor);
        if (ok) auditInserted += 1;
        else auditFailed += 1;
      } else {
        updated += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`  [error] ${day.date}: ${err.message.slice(0, 120)}`);
    }
  }
  return { upserted, inserted, updated, auditInserted, auditFailed, errors };
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
      `[upsert-fumigations] OK: ${stats.upserted} upserts (${stats.inserted} inserted, ${stats.updated} updated), ` +
      `${stats.auditInserted} audit events recorded, ${stats.auditFailed} audit failures, ` +
      `${stats.errors} errors`
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

module.exports = { main, upsertFumigations, recordFumigationCreate, buildCreatedSnapshot, FUMIGATION_SNAPSHOT_FIELDS, ACTOR_SYSTEM_IMPORT, SQL_INSERT_AUDIT };
