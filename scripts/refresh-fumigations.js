// scripts/refresh-fumigations.js
//
// Sprint 2026-08-13 (fix/ci-and-cleanup): script que faltaba para
// el workflow `.github/workflows/refresh-fumigations.yml`. Ese
// workflow corría semanalmente (lunes 06:00 UTC) y fallaba con
// "Cannot find module" porque el archivo no existía.
//
// Decisión de scope (mínima, defensiva, sin tocar data):
//   - Refresca la materialized view `mv_fumigations_monthly`
//     (si existe en la BD). Eso recalcula el dashboard summary
//     sin re-scrapear DJI — es lo que el workflow promete.
//   - Recalcula `last_fumigation_date` y `next_due_date` de
//     `dji_fumigation_schedule` desde la última fumigación real
//     (no soft-deleted) por parcela. Mismo cálculo que hace
//     `createFumigationEvent` al insertar una fumigación nueva.
//   - NO re-scrapea DJI (eso lo hace el pipeline completo en
//     `scripts/import-fumigations-pipeline.js`, que se corre
//     en otro flow).
//
// Decisión: usar `pg` directo (no `api/repositories.ts`) porque
// el workflow corre en Node puro, no en Next.js. Importar
// `api/repositories` arrastra Next config (lib/db.ts usa Next env)
// y rompería el runtime del script.
//
// Uso:
//   node scripts/refresh-fumigations.js
//
// Salida: log con timestamp + counts (antes/después).
// Exit 0 si todo OK, exit 1 si falla.
//
// Requiere env: DATABASE_URL o DATABASE_URL_DIRECT.

const { Client } = require("pg");

const REFRESH_LOG_PREFIX = "[refresh-fumigations]";

function log(level, msg) {
  const ts = new Date().toISOString();
  console.log(`${ts} ${REFRESH_LOG_PREFIX} ${level} ${msg}`);
}

function pickDatabaseUrl() {
  const url =
    process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT;
  if (!url) {
    throw new Error(
      "DATABASE_URL (or DATABASE_URL_DIRECT) is not configured. " +
        "Set it in the env or in GitHub Actions secrets."
    );
  }
  return url;
}

async function refreshMaterializedViews(client) {
  // REFRESH MATERIALIZED VIEW CONCURRENTLY no bloquea lecturas. Si
  // la MV no existe (migration 20260801000000 no aplicada), la query
  // falla con "relation does not exist" — loggeamos warning y seguimos.
  // El workflow no debe fallar solo porque una MV no está creada.
  try {
    log("info", "REFRESH MATERIALIZED VIEW mv_fumigations_monthly");
    await client.query(
      "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly"
    );
    log("info", "MV refrescada OK");
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes("does not exist")) {
      log(
        "warn",
        "mv_fumigations_monthly no existe (migration 20260801000000 sin aplicar). Saltando."
      );
    } else {
      log("warn", `MV refresh falló: ${msg}. Continuando con cadencia.`);
    }
    return false;
  }
}

async function refreshScheduleCadence(client) {
  // Recalcula `last_fumigation_date` y `next_due_date` para todas
  // las parcelas con schedule activo, basándose en la fumigación
  // más reciente (no soft-deleted). Esto es la misma lógica que
  // `createFumigationEvent` aplica al insertar, pero aplicada en
  // bulk para mantener el dashboard sincronizado incluso si DJI
  // no scrapeó nada en la semana.
  //
  // Para parcelas SIN fumigaciones, last_fumigation_date queda
  // NULL (no se inventa data). next_due_date se recalcula solo
  // si hay last_fumigation_date + cadence.
  log("info", "Recalculando cadencia por parcela (bulk UPDATE)…");

  const before = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE last_fumigation_date IS NOT NULL)::int AS with_last,
      COUNT(*) FILTER (WHERE next_due_date IS NOT NULL)::int AS with_next
    FROM dji_fumigation_schedule
    WHERE deleted_at IS NULL AND is_active = TRUE
  `);
  log(
    "info",
    `antes: ${before.rows[0].with_last} schedules con last_fumigation_date, ` +
      `${before.rows[0].with_next} con next_due_date`
  );

  // 1) last_fumigation_date = MAX(fumigation_date) de fumigaciones
  //    no soft-deleted por parcela. CTE + UPDATE con JOIN.
  // 2) next_due_date = last_fumigation_date + recommended_cadence_days
  //    (solo si last_fumigation_date IS NOT NULL y cadence > 0).
  //
  // Hacemos 2 UPDATEs separados:
  //   - El primero setea `last_fumigation_date` (idempotente: la
  //     condición `IS DISTINCT FROM` evita updates innecesarios).
  //   - El segundo setea `next_due_date` basado en el valor ya
  //     actualizado de `last_fumigation_date`. Más simple que
  //     un solo UPDATE con CASE y permite índices separados.

  await client.query(`
    WITH latest_fum AS (
      SELECT parcel_id, MAX(fumigation_date) AS last_fumigation_date
        FROM dji_fumigations
       WHERE deleted_at IS NULL
       GROUP BY parcel_id
    )
    UPDATE dji_fumigation_schedule s
       SET last_fumigation_date = lf.last_fumigation_date,
           updated_at = NOW()
      FROM latest_fum lf
     WHERE s.parcel_id = lf.parcel_id
       AND s.deleted_at IS NULL
       AND s.is_active = TRUE
       AND (s.last_fumigation_date IS DISTINCT FROM lf.last_fumigation_date)
  `);

  await client.query(`
    UPDATE dji_fumigation_schedule s
       SET next_due_date = CASE
             WHEN s.last_fumigation_date IS NULL THEN NULL
             WHEN s.recommended_cadence_days IS NULL OR s.recommended_cadence_days <= 0 THEN NULL
             ELSE s.last_fumigation_date + (s.recommended_cadence_days || ' days')::interval
           END,
           updated_at = NOW()
     WHERE s.deleted_at IS NULL
       AND s.is_active = TRUE
       AND s.last_fumigation_date IS NOT NULL
       AND s.recommended_cadence_days IS NOT NULL
       AND s.recommended_cadence_days > 0
  `);

  const after = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE last_fumigation_date IS NOT NULL)::int AS with_last,
      COUNT(*) FILTER (WHERE next_due_date IS NOT NULL)::int AS with_next
    FROM dji_fumigation_schedule
    WHERE deleted_at IS NULL AND is_active = TRUE
  `);
  log(
    "info",
    `después: ${after.rows[0].with_last} schedules con last_fumigation_date, ` +
      `${after.rows[0].with_next} con next_due_date`
  );
}

async function main() {
  log("info", "iniciando refresh semanal de fumigaciones");
  const dbUrl = pickDatabaseUrl();
  const ssl =
    (process.env.DATABASE_SSL || "true").toLowerCase() === "true";
  const client = new Client({
    connectionString: dbUrl,
    ssl: ssl ? { rejectUnauthorized: false } : false
  });
  try {
    await client.connect();
    log("info", "conectado a la BD");
    await refreshMaterializedViews(client);
    await refreshScheduleCadence(client);
    log("info", "DONE — refresh OK");
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    log("error", `FAILED: ${msg}`);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
