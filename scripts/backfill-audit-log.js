// scripts/backfill-audit-log.js
//
// CLI: popula `fumigation_audit_log` con eventos históricos de
// fumigaciones que ya existían antes de que se desplegara el audit log
// (sprint 2026-08-15). Idempotente — se puede re-ejecutar sin duplicar.
//
// Por qué existe:
//   El audit log (sprint 2026-08-15) solo registra eventos generados
//   DESPUÉS del deploy. Las ~17k fumigaciones históricas que ya estaban
//   en la BD no tienen eventos. El operador fumigador quiere ver la
//   historia completa en el panel "Historial" del detail page.
//
// Qué SÍ popula (desde datos históricos de `dji_fumigations`):
//   - `created` para cada fumigación (usa `recorded_at` + `recorded_by`)
//   - `deleted` para cada fumigación soft-deleted (usa `deleted_at` + `deleted_by`)
//
// Qué NO popula (sin datos históricos):
//   - `edited` — antes de este sprint las ediciones eran SQL UPDATE directo,
//     no hay registro de qué cambió ni cuándo
//   - `restored` — el endpoint /restore es nuevo, no hay restores anteriores
//
// Limitación del snapshot:
//   Los eventos backfilled usan el ESTADO ACTUAL de la fumigación como
//   snapshot (no el estado al momento del evento). Si la fumigación fue
//   editada después, el snapshot del `created` refleja el estado actual
//   y no el original. Marcamos esto en `changes._backfill: true` para
//   que la UI pueda mostrar un badge "Backfill" en el futuro.
//
// Uso:
//   node scripts/backfill-audit-log.js                # ejecutar de verdad
//   node scripts/backfill-audit-log.js --dry-run     # preview sin insertar
//   node scripts/backfill-audit-log.js --limit 100  # solo primeras 100 (smoke test)
//
// Variables de entorno (.env.local):
//   DATABASE_URL o DATABASE_URL_DIRECT
//   DATABASE_SSL (default "false" para docker local)

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) {
      process.env[k] = t.slice(i + 1).trim();
    }
  }
}

function createPool() {
  const connectionString =
    process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL (o DATABASE_URL_DIRECT) no está definida. Carga .env.local o expórtala en el shell."
    );
  }
  const ssl =
    String(process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
  return new Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 4
  });
}

/**
 * Valida los flags CLI. Devuelve {ok:true, opts} o {ok:false, error}.
 * Esta función es testable aislada (no toca BD).
 *
 * @param {string[]} argv
 * @returns {{ok: true, opts: {dryRun: boolean, limit: number|null}} | {ok: false, error: string}}
 */
function parseArgs(argv) {
  const opts = { dryRun: false, limit: null };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      return { ok: false, error: "HELP" };
    } else if (arg.startsWith("--limit=")) {
      const v = arg.slice("--limit=".length);
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          error: `--limit debe ser un entero positivo (recibido: ${v})`
        };
      }
      opts.limit = n;
    } else if (arg.startsWith("--")) {
      return { ok: false, error: `flag desconocido: ${arg}` };
    } else {
      return { ok: false, error: `argumento posicional no soportado: ${arg}` };
    }
  }
  return { ok: true, opts };
}

const HELP = `Uso:
  node scripts/backfill-audit-log.js [--dry-run] [--limit=N]

Flags:
  --dry-run    Cuenta lo que insertaría sin tocar la BD
  --limit=N    Procesa solo las primeras N fumigaciones (smoke test)

Popula fumigation_audit_log con eventos históricos de fumigaciones
que ya existían antes del sprint audit log (2026-08-15). Inserta
eventos 'created' y 'deleted' (cuando aplica) usando los datos de
dji_fumigations.recorded_at / deleted_at / recorded_by / deleted_by.
NO popula 'edited' ni 'restored' (sin datos históricos).
Idempotente: chequea existencia antes de cada insert.
`;

/**
 * Query SQL: traer todas las fumigaciones (o un subset via LIMIT)
 * con los campos necesarios para el backfill.
 */
const SQL_FUMIGATIONS = `
  SELECT id,
         recorded_at,
         recorded_by,
         deleted_at,
         deleted_by,
         parcel_id,
         fumigation_date,
         product_used,
         dose_l_per_ha,
         area_fumigated_m2,
         drone_code_used,
         duration_minutes,
         notes,
         product_registered_ica,
         pilot_license,
         category_id
    FROM dji_fumigations
   ORDER BY id
`;

const SQL_FUMIGATIONS_LIMIT = SQL_FUMIGATIONS + "\n   LIMIT $1";

const SQL_EXISTS = `
  SELECT 1
    FROM fumigation_audit_log
   WHERE fumigation_id = $1
     AND action = $2
   LIMIT 1
`;

const SQL_INSERT = `
  INSERT INTO fumigation_audit_log
    (fumigation_id, action, actor_email, changes, created_at)
  VALUES ($1, $2, $3, $4::jsonb, $5)
  RETURNING id
`;

/**
 * Construye el payload `changes` para el snapshot de un evento
 * backfilled. Mismo shape que `recordFumigationCreate` /
 * `recordFumigationDelete` (en lib/fumigation-audit.ts), más un
 * tag `_backfill: true` para que la UI pueda diferenciar.
 *
 * Usamos el estado ACTUAL de la fumigación como snapshot (no el
 * estado al momento del evento). Esto es honesto y útil — el
 * operador ve qué campos tiene hoy ese registro, aún si la
 * fumigación fue editada después del backfill.
 *
 * @param {Record<string, unknown>} fumigation
 * @param {string} kind — string usado como key en el payload (en práctica 'fields' o 'snapshot')
 * @returns {Record<string, unknown>}
 */
function backfillSnapshot(fumigation, kind) {
  const fields = {
    parcel_id: fumigation.parcel_id,
    fumigation_date: fumigation.fumigation_date,
    product_used: fumigation.product_used,
    dose_l_per_ha: fumigation.dose_l_per_ha,
    area_fumigated_m2: fumigation.area_fumigated_m2,
    drone_code_used: fumigation.drone_code_used,
    duration_minutes: fumigation.duration_minutes,
    notes: fumigation.notes,
    product_registered_ica: fumigation.product_registered_ica,
    pilot_license: fumigation.pilot_license,
    category_id: fumigation.category_id
  };
  // Normalizar undefined → null
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) fields[k] = null;
  }
  // nullify nulls también
  return {
    _backfill: true,
    _note:
      "Reconstruido del estado actual de la BD. Si la fumigación fue editada después del deploy del audit log, este snapshot refleja el estado actual, no el original.",
    [kind]: fields
  };
}

const ACTOR_UNKNOWN_DELETED = "unknown@aeroadmin.local";
const ACTOR_SYSTEM_IMPORT = "system@dji-import";

/**
 * Itera fumigaciones, inserta eventos `created` (siempre) y
 * `deleted` (si soft-deleted) en `fumigation_audit_log`, con
 * idempotencia. Devuelve stats detalladas.
 *
 * @param {object} client — pg client o mock
 * @param {{dryRun?: boolean, limit?: number|null}} opts
 * @returns {Promise<{total: number, created_inserted: number, created_skipped: number, deleted_inserted: number, deleted_skipped: number, deleted_skipped_not_soft_deleted: number}>}
 */
async function backfillAuditLog(client, opts) {
  const dryRun = opts.dryRun ?? false;
  const stats = {
    total: 0,
    created_inserted: 0,
    created_skipped: 0,
    deleted_inserted: 0,
    deleted_skipped: 0,
    deleted_skipped_not_soft_deleted: 0
  };

  const fumRes = await client.query(
    opts.limit != null ? SQL_FUMIGATIONS_LIMIT : SQL_FUMIGATIONS,
    opts.limit != null ? [opts.limit] : []
  );
  const fumigations = fumRes.rows;
  stats.total = fumigations.length;

  for (const f of fumigations) {
    // === 1. Evento 'created' ===
    const createdExists = await client.query(SQL_EXISTS, [f.id, "created"]);
    if (createdExists.rows.length === 0) {
      const actor = f.recorded_by || ACTOR_SYSTEM_IMPORT;
      const timestamp = f.recorded_at;
      const changes = backfillSnapshot(f, "fields");
      if (!dryRun) {
        await client.query(SQL_INSERT, [
          f.id,
          "created",
          actor,
          JSON.stringify(changes),
          timestamp
        ]);
      }
      stats.created_inserted++;
    } else {
      stats.created_skipped++;
    }

    // === 2. Evento 'deleted' (solo si soft-deleted) ===
    if (f.deleted_at == null) {
      stats.deleted_skipped_not_soft_deleted++;
    } else {
      const deletedExists = await client.query(SQL_EXISTS, [f.id, "deleted"]);
      if (deletedExists.rows.length === 0) {
        const actor = f.deleted_by || ACTOR_UNKNOWN_DELETED;
        const timestamp = f.deleted_at;
        const changes = backfillSnapshot(f, "snapshot");
        if (!dryRun) {
          await client.query(SQL_INSERT, [
            f.id,
            "deleted",
            actor,
            JSON.stringify(changes),
            timestamp
          ]);
        }
        stats.deleted_inserted++;
      } else {
        stats.deleted_skipped++;
      }
    }
  }

  return stats;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    if (parsed.error === "HELP") {
      console.log(HELP);
      process.exit(0);
    }
    console.error(`Error: ${parsed.error}\n`);
    console.log(HELP);
    process.exit(1);
  }

  loadLocalEnv();
  const pool = createPool();
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    if (parsed.opts.dryRun) {
      console.log("[backfill-audit-log] DRY RUN — no se insertará nada");
    }
    const stats = await backfillAuditLog(client, parsed.opts);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
    console.log("[backfill-audit-log] Stats:");
    console.log(`  total fumigations processed: ${stats.total}`);
    console.log(`  created:  ${stats.created_inserted} inserted, ${stats.created_skipped} already existed`);
    console.log(
      `  deleted:  ${stats.deleted_inserted} inserted, ${stats.deleted_skipped} already existed, ${stats.deleted_skipped_not_soft_deleted} not soft-deleted`
    );
    console.log(`  elapsed:  ${elapsed}s`);
    if (parsed.opts.dryRun) {
      console.log("\n[backfill-audit-log] (dry-run) re-run sin --dry-run para aplicar");
    }
  } catch (err) {
    console.error("[backfill-audit-log] error:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  backfillSnapshot,
  backfillAuditLog
};
