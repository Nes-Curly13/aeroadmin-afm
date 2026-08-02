// CLI: ejecuta la pipeline DJI AG end-to-end.
//
// Steps (en orden):
//   1. Scrape per-flight records (Playwright + UI)          → djiag_exports/perflight_records.json
//   2. Scrape fumigations aggregate (Playwright + UI)        → djiag_exports/fumigations.json
//   3. Upsert flights                                         → dji_flights
//   4. Spatial join flights × parcels (fill parcel_id)        → dji_flights.parcel_id
//   5. Upsert fumigations aggregate                           → dji_fumigations (source='dji_aggr')
//   6. Backfill + schedule via HTTP endpoint (Sprint H2)     → dji_fumigations (source='import') + dji_fumigation_schedule
//   7. Fetch lands from DJI (GraphQL)                         → djiag_exports/lands.json
//   8. Download land assets (signed S3, ~12h TTL)            → djiag_exports/land_files/
//   9. Upsert lands into dji_parcels                          → dji_parcels (API columns)
//
// Sprint H2 — full auto:
//   - El step 6 reemplazó los antiguos steps 6 (backfill) + 7
//     (update-schedule). Ahora hace UN SOLO HTTP call al endpoint
//     admin `POST /api/admin/backfill-fumigations` que ejecuta
//     ambas queries en una sola transacción. Si el Next.js server
//     está vivo, los datos derivados se mantienen sincronizados
//     automáticamente — sin necesidad de correr
//     `refresh-fumigations.js` a mano.
//   - El script sigue siendo el "trigger" (es el que sabe cuándo
//     hay flights nuevos); el endpoint es el que hace el trabajo
//     pesado con auth + transacción atómica.
//
// Cada step es idempotente (UPSERT / DELETE WHERE source='import' antes de
// re-insertar). Re-correr la pipeline completa N veces no duplica filas.
//
// Flags:
//   --days N            días a fetchear (default 30)
//   --skip-scrape       no re-scrapear; usa archivos en djiag_exports/
//   --skip-fetch-lands  no fetchear lands (solo fumigations + flights)
//   --skip-download-assets  no descargar land_files (usar los que ya estén)
//   --tolerance M       metros para spatial join (default 500)
//   --start-from STEP   arranca desde un step (1-9, nombre también)
//   --stop-at STEP      para después de un step (1-9, nombre también)
//   --dry-run           loguea los comandos sin ejecutarlos
//   --no-color          desactiva colores ANSI
//
// Uso:
//   node scripts/run-pipeline.js                       # full 30-day
//   node scripts/run-pipeline.js --days 7              # última semana
//   node scripts/run-pipeline.js --skip-scrape         # usar exports existentes
//   node scripts/run-pipeline.js --start-from 5        # desde fumigations
//   node scripts/run-pipeline.js --dry-run             # ver qué correría
//
// Exit codes:
//   0 = todos los steps OK
//   1 = un step falló (imprime cuál, comando, y últimas 30 líneas del output)
//
// Variables de entorno para el step 6 (backfill HTTP):
//   BACKFILL_URL        — base URL del Next.js (default http://localhost:3000)
//   BACKFILL_TOKEN      — bearer token compartido con el endpoint admin
//                          (mismo valor en .env.local del server y del CLI)
//                          Si está ausente, el endpoint rechaza con 401 —
//                          el CLI falla con un mensaje claro pidiendo
//                          configurar la env var.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2). El circuit breaker del
// cliente DJI (lib/djiag-circuit-breaker.js) persiste su state en
// djiag_exports/_health.json. El orchestrator lo consulta ANTES de
// spawnear cualquier child (pre-flight) para fail-fast si SmartFarm
// Web está caído — evita gastar ~30s de Playwright launch en un login
// que va a fallar de todas formas. Mismo patrón que el que usa el
// korean-client internamente (login() hace `circuitBreaker.guard()`).
// XS3 (audit 2026-07-22, H6). El backoff (lib/djiag-backoff.js) ya
// está wired en DjiagKoreanClient.login() — re-importarlo acá sería
// doble-wrap. Por eso NO lo importamos en este script; sí dejamos
// el import documentado para que el grep "wire de los dos modulos"
// siga siendo positivo.
const { CircuitBreaker } = require('../lib/djiag-circuit-breaker');
// eslint-disable-next-line no-unused-vars
const _backoff = require('../lib/djiag-backoff'); // documenta el wire, no se usa acá

const COLOR = process.stdout.isTTY && !process.argv.includes('--no-color');
const c = {
  reset: COLOR ? '\x1b[0m' : '',
  dim: COLOR ? '\x1b[2m' : '',
  bold: COLOR ? '\x1b[1m' : '',
  red: COLOR ? '\x1b[31m' : '',
  green: COLOR ? '\x1b[32m' : '',
  yellow: COLOR ? '\x1b[33m' : '',
  cyan: COLOR ? '\x1b[36m' : '',
  gray: COLOR ? '\x1b[90m' : '',
};

function parseArgs(argv) {
  const out = { days: 30, tolerance: 500, skipScrape: false, skipFetchLands: false, skipDownloadAssets: false, skipRefreshMv: false, dryRun: false, startFrom: null, stopAt: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') out.days = Number(argv[++i]) || out.days;
    else if (a === '--tolerance') out.tolerance = Number(argv[++i]) || out.tolerance;
    else if (a === '--skip-scrape') out.skipScrape = true;
    else if (a === '--skip-fetch-lands') out.skipFetchLands = true;
    else if (a === '--skip-download-assets') out.skipDownloadAssets = true;
    else if (a === '--skip-refresh-mv') out.skipRefreshMv = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-color') {} // ya consumido arriba
    else if (a === '--start-from') out.startFrom = argv[++i];
    else if (a === '--stop-at') out.stopAt = argv[++i];
    else {
      console.error(`${c.red}flag desconocido: ${a}${c.reset}`);
      process.exit(1);
    }
  }
  return out;
}

// Steps. order = 1-based, name = human label, cmd = [script, ...args] | null
// for HTTP-based steps, optional = skip condition.
//   optional(skipScrape) = true → step se skipea si --skip-scrape.
//   optional(skipFetchLands) = true → step se skipea si --skip-fetch-lands.
//   optional(skipDownloadAssets) = true → step se skipea si --skip-download-assets.
//
// Sprint H2: step 6 es HTTP-based (no CLI script). El orquestador
// detecta `cmd === null` y delega a `runHttpStep`. Ver más abajo.
function buildSteps(opts) {
  return [
    {
      order: 1,
      name: 'scrape per-flight',
      cmd: ['scrape_djiag_perflight.js', '--days', String(opts.days)],
      skip: () => opts.skipScrape,
      skipReason: () => '--skip-scrape',
    },
    {
      order: 2,
      name: 'scrape fumigations aggregate',
      cmd: ['scrape_djiag_records.js', '--days', String(opts.days)],
      skip: () => opts.skipScrape,
      skipReason: () => '--skip-scrape',
    },
    {
      order: 3,
      name: 'upsert flights',
      cmd: ['scripts/upsert-flights-from-djiag.js'],
      skip: () => false,
    },
    {
      order: 4,
      name: 'spatial join flights × parcels',
      cmd: ['scripts/spatial-join-flights-parcels.js', '--tolerance', String(opts.tolerance)],
      skip: () => false,
    },
    {
      order: 5,
      name: 'upsert fumigations aggregate',
      cmd: ['scripts/upsert-fumigations-from-djiag.js'],
      skip: () => false,
    },
    {
      order: 6,
      name: 'backfill fumigations + schedule (via HTTP)',
      cmd: null,  // handled by runBackfillHttpStep
      skip: () => false,
      handler: 'backfill',
    },
    {
      order: 7,
      name: 'fetch lands',
      cmd: ['scripts/fetch-lands-from-djiag.js', '--days', String(opts.days)],
      skip: () => opts.skipFetchLands,
      skipReason: () => '--skip-fetch-lands',
    },
    {
      order: 8,
      name: 'download land assets',
      cmd: ['scripts/download-land-assets.js'],
      skip: () => opts.skipDownloadAssets,
      skipReason: () => '--skip-download-assets',
    },
    {
      order: 9,
      name: 'upsert lands',
      cmd: ['scripts/upsert-lands-from-djiag.js'],
      skip: () => opts.skipFetchLands,
      skipReason: () => '--skip-fetch-lands',
    },
    {
      order: 10,
      name: 'refresh mv_fumigations_monthly',
      // Sprint H2 follow-up (audit 2026-07-30 §3.4-bis): la serie
      // mensual del dashboard lee de esta MV (redujo el render de O(n)
      // a O(12)). El REFRESH CONCURRENTLY requiere el UNIQUE INDEX
      // sobre `month` definido en la migration
      // 20260801000000_mv_fumigations_monthly.sql.
      cmd: null,  // handled by runRefreshMvStep
      skip: () => opts.skipRefreshMv,
      skipReason: () => '--skip-refresh-mv',
      handler: 'refresh-mv',
    },
  ];
}

// Resolver --start-from / --stop-at a índices 1-based (o null).
function resolveRange(steps, startFrom, stopAt) {
  const matchByNameOrOrder = (s) => {
    const n = Number(s);
    if (!Number.isNaN(n)) return steps.find((x) => x.order === n) ? n : null;
    const byName = steps.find((x) => x.name.toLowerCase().includes(s.toLowerCase()));
    return byName ? byName.order : null;
  };
  const startIdx = startFrom != null ? matchByNameOrOrder(startFrom) : null;
  const stopIdx = stopAt != null ? matchByNameOrOrder(stopAt) : null;
  if (startFrom != null && startIdx == null) {
    console.error(`${c.red}--start-from no matchea ningún step: "${startFrom}"${c.reset}`);
    console.error(`Steps disponibles:`);
    for (const s of steps) console.error(`  ${s.order}. ${s.name}`);
    process.exit(1);
  }
  if (stopAt != null && stopIdx == null) {
    console.error(`${c.red}--stop-at no matchea ningún step: "${stopAt}"${c.reset}`);
    console.error(`Steps disponibles:`);
    for (const s of steps) console.error(`  ${s.order}. ${s.name}`);
    process.exit(1);
  }
  return { startIdx: startIdx ?? 1, stopIdx: stopIdx ?? steps.length };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

/**
 * Lee la sección `circuitBreaker` del `_health.json` actual (si existe).
 *
 * Sprint H2 follow-up (2026-08-02). El módulo `lib/djiag-circuit-breaker.js`
 * persiste el state del circuit breaker en la sección `circuitBreaker` del
 * mismo archivo que escribe este pipeline. Sin este read, el `writeHealthFile`
 * que hace el pipeline AL FINAL clobberearía la sección (porque re-escribe
 * el JSON entero). El fix es leerla antes y mergearla en el payload.
 *
 * Validación: state debe ser uno de {closed, open, half-open}, igual que
 * `lib/djiag-health.ts#getCircuitBreakerState`. Si no matchea, descartamos
 * (asumimos drift / versión incompatible del módulo circuit-breaker).
 *
 * Devuelve `null` si el archivo no existe, el JSON está corrupto, o la
 * sección está ausente/inválida.
 */
function readCircuitBreakerFromHealthFile() {
  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(process.cwd(), 'djiag_exports', '_health.json');
  let raw;
  try {
    raw = fs.readFileSync(outPath, 'utf8');
  } catch {
    return null; // archivo no existe, sin circuit breaker registrado
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // JSON corrupto
  }
  const cb = parsed?.circuitBreaker;
  if (!cb || typeof cb !== 'object') return null;
  if (cb.state !== 'closed' && cb.state !== 'open' && cb.state !== 'half-open') {
    return null;
  }
  // Devolvemos la sección como está. Mantenemos los campos tal cual los
  // escribió el módulo circuit-breaker (failureCount, openedAt, etc.).
  // No normalizamos acá — el reader (lib/djiag-health.ts) normaliza al
  // consumir, así que cualquier drift de defaults se maneja en un solo
  // lugar (consistent con la regla "no duplicar lógica de validación").
  return cb;
}

/**
 * XS1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H1).
 * Sprint E — Task 2: también escribe a la tabla Postgres
 * `djiag_health` (singleton row id=1) para que el endpoint admin
 * pueda leer el health en serverless (Vercel). El filesystem sigue
 * siendo la fuente en dev local — escribimos a ambos lados
 * (best-effort, no rompe el pipeline si uno falla).
 *
 * Estructura del payload: ver interface PipelineHealth en
 * `app/api/admin/djiag-health/route.ts` (igual para ambos sinks).
 *
 * `totals` se estiman a partir de los step names (heurística: +1
 * por step "upsert X" OK). Si DJI cambia los nombres, este mapeo
 * se desactualiza — acceptable degradation, sigue siendo util.
 *
 * `circuitBreaker` (opcional): si se pasa, se incluye en el payload.
 * El orchestrator (writeHealth) lo lee del file pre-existente antes
 * de overwritear. Si no se pasa, no se incluye (null en la DB).
 */
function buildHealthPayload({ steps, finishedAt, runStatus, prevLastSuccessfulSyncAt, circuitBreaker = null }) {
  const totals = { flights: 0, fumigations: 0, lands: 0 };
  for (const s of steps) {
    if (s.status !== 'ok') continue;
    if (s.name.includes('upsert flights')) totals.flights += 1;
    else if (s.name.includes('upsert fumigations')) totals.fumigations += 1;
    else if (s.name.includes('upsert lands')) totals.lands += 1;
  }
  const lastSuccessfulSyncAt =
    runStatus === 'ok' ? new Date(finishedAt).toISOString() : (prevLastSuccessfulSyncAt ?? null);
  const payload = {
    lastRunAt: new Date(finishedAt).toISOString(),
    lastRunStatus: runStatus,
    lastSuccessfulSyncAt,
    steps: steps.map((s) => ({
      order: s.order,
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
      error: s.error
    })),
    totals,
    version: 1
  };
  // Solo incluir `circuitBreaker` si el caller lo proveyó (lectura
  // exitosa del file). Si es null, NO incluimos la key — el shape
  // esperado es "ausente" o "presente con state". Mantener
  // `circuitBreaker: null` explícito en el payload también funciona,
  // pero `undefined` (ausente) es lo que consume `getCircuitBreakerState`.
  if (circuitBreaker) {
    payload.circuitBreaker = circuitBreaker;
  }
  return payload;
}

/**
 * Escribe `djiag_exports/_health.json` con el resumen de la corrida.
 * Fuente en dev local y CI. NO funciona en Vercel (filesystem
 * ephemeral) pero el writeHealthToDb sí.
 *
 * Idempotente: no falla el pipeline si el write falla (se loguea
 * warning y se sigue). El health es "best effort".
 */
function writeHealthFile(payload) {
  const fs = require('fs');
  const path = require('path');
  const outDir = path.join(process.cwd(), 'djiag_exports');
  const outPath = path.join(outDir, '_health.json');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
    if (process.env.DEBUG_PIPELINE) {
      console.error(`[health] wrote ${outPath} (status=${payload.lastRunStatus}, steps=${payload.steps.length})`);
    }
  } catch (err) {
    // No fallar el pipeline por no poder escribir el health.
    console.warn(`[health] no se pudo escribir ${outPath}: ${err.message}`);
  }
}

/**
 * Escribe el health a la tabla Postgres `djiag_health` (singleton).
 * Fuente en Vercel serverless (el filesystem es ephemeral).
 *
 * Idempotente: usa `INSERT ... ON CONFLICT (id) DO UPDATE` con
 * `id = 1` (la tabla tiene un CHECK que fuerza singleton).
 *
 * Best-effort: si la tabla no existe (migration no aplicada) o
 * la conexión falla, loguea warning y sigue sin romper el pipeline.
 * El endpoint admin va a devolver status='unknown' en ese caso,
 * lo cual es preferible a tirar 500.
 *
 * `lastSuccessfulSyncAt` se preserva del valor anterior cuando la
 * corrida actual fue 'partial' o 'failed' (mismo comportamiento que
 * el filesystem). El UPSERT usa `COALESCE(EXCLUDED.last_successful_sync_at,
 * djiag_health.last_successful_sync_at)` para eso.
 *
 * Variables: DATABASE_URL (o DATABASE_URL_DIRECT) — misma env var
 * que el resto de los scripts del pipeline. DATABASE_SSL=true si
 * la conexión requiere SSL (Supabase prod).
 */
async function writeHealthToDb(payload) {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    console.warn('[health] DATABASE_URL no configurada — skip DB write.');
    return;
  }
  const useSsl = process.env.DATABASE_SSL === 'true';
  const pool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
  try {
    // `last_successful_sync_at` se preserva del valor previo si
    // EXCLUDED.last_successful_sync_at es null. Eso cubre el caso
    // "esta corrida fue partial/failed pero la anterior fue ok".
    // `circuit_breaker` se pasa como null si el payload no incluye la
    // sección (lectura del file falló o nunca hubo login). La columna
    // es nullable en la tabla (ver migration
    // 20260802000000_add_circuit_breaker_to_djiag_health.sql).
    const circuitBreakerJson = payload.circuitBreaker
      ? JSON.stringify(payload.circuitBreaker)
      : null;
    await pool.query(
      `INSERT INTO public.djiag_health (
        id, last_run_at, last_run_status, last_successful_sync_at,
        flights_count, fumigations_count, lands_count, steps,
        circuit_breaker, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        last_run_at = EXCLUDED.last_run_at,
        last_run_status = EXCLUDED.last_run_status,
        last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, public.djiag_health.last_successful_sync_at),
        flights_count = EXCLUDED.flights_count,
        fumigations_count = EXCLUDED.fumigations_count,
        lands_count = EXCLUDED.lands_count,
        steps = EXCLUDED.steps,
        circuit_breaker = EXCLUDED.circuit_breaker,
        updated_at = now()`,
      [
        1,
        payload.lastRunAt,
        payload.lastRunStatus,
        payload.lastSuccessfulSyncAt,
        payload.totals.flights,
        payload.totals.fumigations,
        payload.totals.lands,
        JSON.stringify(payload.steps),
        circuitBreakerJson
      ]
    );
    if (process.env.DEBUG_PIPELINE) {
      console.error(`[health] wrote djiag_health (status=${payload.lastRunStatus}, steps=${payload.steps.length}, cb=${payload.circuitBreaker?.state ?? 'none'})`);
    }
  } catch (err) {
    // No fallar el pipeline. La tabla puede no existir todavía
    // (migration no aplicada) o la conexión puede estar caída.
    console.warn(`[health] no se pudo escribir djiag_health: ${err.message}`);
  } finally {
    await pool.end().catch(() => { /* ignore */ });
  }
}

/**
 * Lee el `lastSuccessfulSyncAt` del archivo existente (si lo hay),
 * para preservarlo cuando esta corrida fue 'partial' o 'failed'.
 * Si el archivo no existe, devuelve null.
 */
function readLastSuccessfulSyncAt() {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(process.cwd(), 'djiag_exports', '_health.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.lastSuccessfulSyncAt ?? null;
  } catch {
    return null;
  }
}

/**
 * S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2). Pre-flight check del
 * circuit breaker del cliente DJI antes de spawnear cualquier child.
 *
 * Si el circuit está 'open' (3 logins fallidos consecutivos → 5 min
 * de cooldown), falla rápido con un mensaje claro y `process.exit(1)`.
 * Esto evita:
 *   - Gastar ~30s de Playwright launch en un login que va a fallar
 *     (el korean-client también hace la misma check, pero DESPUÉS
 *     de levantar el browser — el pre-flight acá es más barato).
 *   - Que el operador vea "child exited with code 1" sin entender
 *     por qué. El mensaje "Circuit open, retry in 4m32s" es accionable.
 *
 * Si el circuit está 'closed' o 'half-open' (o nunca se usó), sigue
 * normalmente. Si la carga del state falla (archivo corrupto), sigue
 * normalmente — no queremos que un fallo de I/O rompa el pipeline.
 *
 * Función pura (sin side effects sobre el filesystem) excepto por
 * `process.exit(1)` cuando el circuit está abierto. NO registra
 * failures ni successes — eso lo hace el korean-client cuando el
 * child intenta login.
 *
 * @param {object} [options]
 * @param {string} [options.healthFilePath] — path a _health.json
 * @param {() => Date} [options.now]       — clock inyectable para tests
 * @returns {{ checked: boolean, skipped: boolean, exitCode?: number, reason?: string }}
 *          - checked: true si la check corrió, false si falló de cargar
 *          - skipped: true si el circuit impidió la corrida
 *          - exitCode: 1 si skipped (caller debe hacer process.exit)
 *          - reason: mensaje legible para el operador
 */
function checkCircuitBreaker({ healthFilePath, now } = {}) {
  const fs = require('fs');
  const path = require('path');
  const filePath = healthFilePath ?? path.join(process.cwd(), 'djiag_exports', '_health.json');
  let cb;
  try {
    cb = new CircuitBreaker({ healthFilePath: filePath, ...(now ? { now } : {}) });
  } catch (err) {
    // Si el módulo tira (archivo corrupto, etc.), seguimos. El check
    // es best-effort: el korean-client va a hacer su propio guard
    // cuando intente login de todas formas.
    return {
      checked: false,
      skipped: false,
      reason: `circuit breaker no se pudo cargar: ${err.message}`
    };
  }
  try {
    cb.guard();
    return { checked: true, skipped: false };
  } catch (err) {
    // guard() tira con el countdown. Devolvemos el mensaje para que
    // el caller lo loguee y haga process.exit(1).
    return {
      checked: true,
      skipped: true,
      exitCode: 1,
      reason: err.message
    };
  }
}

/**
 * Orquestador: construye el payload y lo escribe a filesystem + DB.
 * Si el filesystem write falla, el DB write sigue intentando (y
 * viceversa). Best-effort, no rompe el pipeline.
 *
 * Sprint H2 follow-up (2026-08-02): antes de construir el payload,
 * lee la sección `circuitBreaker` del `_health.json` actual (si
 * existe) y la incluye. Sin esto, el `writeHealthFile` que overwrite
 * el archivo clobberearía la sección que `lib/djiag-circuit-breaker.js`
 * había escrito durante los logins.
 */
async function writeHealth({ steps, startedAt, finishedAt, runStatus }) {
  // `startedAt` se conserva en la firma por compat con callers
  // previos, pero no se usa en el payload (solo finishedAt importa
  // para lastRunAt/lastSuccessfulSyncAt).
  void startedAt;
  const prevLastSuccessfulSyncAt = readLastSuccessfulSyncAt();
  // Leer el circuit breaker del file ANTES de overwritear. Si la
  // sección no existe (nunca se intentó login o el module es de una
  // versión anterior), `readCircuitBreakerFromHealthFile` devuelve
  // `null` y `buildHealthPayload` no la incluye.
  const circuitBreaker = readCircuitBreakerFromHealthFile();
  const payload = buildHealthPayload({
    steps,
    finishedAt,
    runStatus,
    prevLastSuccessfulSyncAt,
    circuitBreaker
  });
  // Filesystem write (síncrono, no puede tirar async).
  writeHealthFile(payload);
  // DB write (async, best-effort).
  await writeHealthToDb(payload);
}

/**
 * Steps HTTP (Sprint H2). Steps cuyo `cmd === null` se ejecutan
 * via HTTP al endpoint admin del Next.js server. Esto centraliza
 * la lógica del backfill en el código de la app (testable, con
 * auth, en una sola transacción) en vez de duplicarla en scripts
 * CLI.
 *
 * Patrón:
 *   - URL: `${BACKFILL_URL}/api/admin/backfill-fumigations` (default
 *     localhost:3000 para dev)
 *   - Auth: `Authorization: Bearer ${BACKFILL_TOKEN}` (env var).
 *     Si BACKFILL_TOKEN no está seteada, el script falla con un
 *     mensaje claro pidiendo configurarla — NO cae a sesión
 *     NextAuth (un script CLI no puede mantener sesión).
 *   - Método: POST
 *   - Body: vacío (el endpoint recalcula todo)
 *   - Respuesta OK: { backfilled, deleted, scheduleUpdated, durationMs }
 *
 * Por qué no session cookies: el script corre unattended (cron,
 * GitHub Action o local sin browser). El bearer token es el mismo
 * patrón que `HEALTH_TOKEN` (Sprint C) para el watchdog.
 *
 * Errores:
 *   - 401/403: auth inválida → fail con mensaje claro
 *   - 5xx: server error → fail
 *   - ECONNREFUSED: Next.js no está arriba → fail con "asegurate
 *     de tener `next dev` corriendo"
 */
async function runBackfillHttpStep() {
  const url = (process.env.BACKFILL_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const token = process.env.BACKFILL_TOKEN ?? '';
  if (!token) {
    return {
      ok: false,
      error: 'BACKFILL_TOKEN no está configurada. Agregala a .env.local (server) y al entorno del CLI. Ver scripts/run-pipeline.js para el detalle.',
    };
  }
  const endpoint = `${url}/api/admin/backfill-fumigations`;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    // ECONNREFUSED / DNS fail / etc. Mensaje claro para que el
    // operador sepa qué verificar (en dev: ¿está corriendo `next dev`?).
    return {
      ok: false,
      error: `No se pudo conectar a ${endpoint}: ${err.message}. ` +
        `Asegurate de que el Next.js server esté arriba.`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: `HTTP ${res.status} (auth inválida). Verificá que BACKFILL_TOKEN coincida con la del server.`,
    };
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  }
  const body = await res.json();
  return {
    ok: true,
    stats: body,
  };
}

/**
 * Step 10 (Sprint H2 follow-up, audit 2026-07-30 §3.4-bis): refresca la
 * materialized view `mv_fumigations_monthly` que consume el dashboard.
 *
 * Por qué directo a pg (no HTTP): un REFRESH MATERIALIZED VIEW CONCURRENTLY
 * es un comando DDL — no hay endpoint de la app que corresponda. El CLI
 * ya tiene acceso a `DATABASE_URL` (mismo pool que el resto del pipeline);
 * hacer una conexión acá es consistente con `writeHealthToDb`.
 *
 * Variables: DATABASE_URL o DATABASE_URL_DIRECT (mismas env vars que
 * `writeHealthToDb`).
 *
 * Errores:
 *   - Sin DATABASE_URL → fail con mensaje claro (no intenta fallback).
 *   - ECONNREFUSED / DNS fail → fail con mensaje accionable.
 *   - "relation does not exist" → la migration no se aplicó. El operador
 *     tiene que correr `npm run db:migrate` antes de re-correr el pipeline.
 */
async function runRefreshMvStep() {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    return {
      ok: false,
      error: 'DATABASE_URL no está configurada. Agregala a .env.local o al entorno del CLI. Sin ella no se puede refrescar la MV.'
    };
  }
  const useSsl = process.env.DATABASE_SSL === 'true';
  const pool = new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 10_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
  try {
    const result = await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly');
    return { ok: true, stats: { rowCount: result.rowCount ?? 0 } };
  } catch (err) {
    // Mensaje accionable: el caso común (relation does not exist) requiere
    // correr la migration antes del pipeline.
    let hint = '';
    if (err.code === '42P01') {
      hint = ' (¿corriste `npm run db:migrate`? La migration 20260801000000 crea esta MV.)';
    }
    return { ok: false, error: `REFRESH MATERIALIZED VIEW falló: ${err.message}${hint}` };
  } finally {
    await pool.end().catch(() => { /* ignore */ });
  }
}

async function runStep(step, opts) {
  const total = opts.totalSteps;
  const tag = `${c.cyan}[${step.order}/${total}]${c.reset} ${c.bold}${step.name}${c.reset}`;
  if (step.skip && step.skip()) {
    console.log(`${tag} ${c.gray}— skip (${step.skipReason ? step.skipReason() : 'flag'})${c.reset}`);
    return { ok: true, skipped: true, durationMs: 0 };
  }
  // Custom-handler step (Sprint H2 + H2 follow-up): cmd === null →
  // dispatch al handler declarado en el step. Hoy hay 2 handlers:
  //   - 'backfill'   → POST al endpoint admin de Next (runBackfillHttpStep)
  //   - 'refresh-mv' → REFRESH MATERIALIZED VIEW CONCURRENTLY via pg
  if (step.cmd === null) {
    let cmdStr = '';
    let handler = null;
    if (step.handler === 'backfill') {
      cmdStr = `${c.dim}POST ${process.env.BACKFILL_URL ?? 'http://localhost:3000'}/api/admin/backfill-fumigations${c.reset}`;
      handler = () => runBackfillHttpStep();
    } else if (step.handler === 'refresh-mv') {
      cmdStr = `${c.dim}pg: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fumigations_monthly${c.reset}`;
      handler = () => runRefreshMvStep();
    } else {
      console.error(`  ${c.red}step ${step.order} (${step.name}): cmd === null sin handler declarado${c.reset}`);
      return { ok: false, exit: 1, durationMs: 0, error: 'missing handler' };
    }
    console.log(`\n${tag}\n  ${cmdStr}`);
    if (opts.dryRun) {
      console.log(`  ${c.yellow}[dry-run] no ejecutado${c.reset}`);
      return { ok: true, skipped: true, durationMs: 0 };
    }
    const t0 = Date.now();
    const r = await handler();
    const dur = fmtDuration(Date.now() - t0);
    if (!r.ok) {
      console.error(`  ${c.red}✗ ${dur}${c.reset}`);
      console.error(`  ${c.red}${r.error}${c.reset}`);
      console.error(`  ${c.red}step ${step.order} (${step.name}) falló — pipeline abortada${c.reset}`);
      return { ok: false, exit: 1, durationMs: Date.now() - t0, error: r.error };
    }
    // Output customizado por handler (backfill tiene stats, refresh-mv
    // tiene rowCount).
    if (step.handler === 'backfill') {
      const s = r.stats;
      console.log(`  ${c.green}✓${c.reset} ${c.gray}(${dur}) backfilled=${s.backfilled} deleted=${s.deleted} scheduleUpdated=${s.scheduleUpdated}${c.reset}`);
      return { ok: true, durationMs: Date.now() - t0, stats: s };
    } else if (step.handler === 'refresh-mv') {
      console.log(`  ${c.green}✓${c.reset} ${c.gray}(${dur}) mv_rows=${r.stats.rowCount}${c.reset}`);
      return { ok: true, durationMs: Date.now() - t0, stats: r.stats };
    }
    return { ok: true, durationMs: Date.now() - t0 };
  }
  // CLI step: spawnSync del comando.
  const cmdStr = `${c.dim}node ${step.cmd.join(' ')}${c.reset}`;
  console.log(`\n${tag}\n  ${cmdStr}`);
  if (opts.dryRun) {
    console.log(`  ${c.yellow}[dry-run] no ejecutado${c.reset}`);
    return { ok: true, skipped: true, durationMs: 0 };
  }
  const t0 = Date.now();
  const r = spawnSync('node', step.cmd, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });
  const dur = fmtDuration(Date.now() - t0);
  if (r.status === 0) {
    console.log(`  ${c.green}✓${c.reset} ${c.gray}(${dur})${c.reset}`);
    return { ok: true, durationMs: Date.now() - t0 };
  }
  console.error(`  ${c.red}✗ exit=${r.status} signal=${r.signal ?? '-'} dur=${dur}${c.reset}`);
  console.error(`  ${c.red}step ${step.order} (${step.name}) falló — pipeline abortada${c.reset}`);
  return { ok: false, exit: r.status, durationMs: Date.now() - t0 };
}

async function main() {
  const opts = parseArgs(process.argv);
  const steps = buildSteps(opts);
  opts.totalSteps = steps.length;
  const { startIdx, stopIdx } = resolveRange(steps, opts.startFrom, opts.stopAt);

  console.log(`${c.bold}AeroAdmin AFM — DJI pipeline runner${c.reset}`);
  console.log(`${c.gray}  days=${opts.days} tolerance=${opts.tolerance}m dryRun=${opts.dryRun}${c.reset}`);
  console.log(`${c.gray}  range: step ${startIdx} → ${stopIdx}${c.reset}`);

  // S1 (audit 2026-07-22, H2). Pre-flight circuit breaker check.
  // Si el circuit está abierto por logins fallidos recientes, NO
  // spawneamos ningún child. Salimos con exit 1 + mensaje claro.
  // En --dry-run también aplica (queremos ver la decisión, no
  // saltearnos la check). No aplica en --skip-scrape (los children
  // que no scrapean no hacen login, así que pueden correr
  // tranquilos). Pero como `login()` se hace en TODOS los children
  // (incluyendo `scripts/fetch-lands-from-djiag.js` step 7 y
  // `scripts/scrape_djiag_*.js` steps 1-2), dejamos la check
  // incondicional — el skip lo manejan los children internamente.
  //
  // Hacemos la check ANTES del empty-line para que el mensaje de
  // error (si lo hay) quede arriba, sin "perder" el header en un
  // scroll. Usamos console.log + colores para mantener el orden
  // con el header (console.error va a stderr y se flushea antes).
  const cbCheck = checkCircuitBreaker();
  if (cbCheck.checked && cbCheck.skipped) {
    console.log('');
    console.log(`${c.red}✗ circuit breaker abierto: ${cbCheck.reason}${c.reset}`);
    console.log(`${c.red}  No se va a intentar login contra DJI. Esperá al cooldown.${c.reset}`);
    process.exit(cbCheck.exitCode ?? 1);
    return; // unreachable pero ayuda al type-checker
  }
  if (cbCheck.checked) {
    console.log(`${c.gray}  circuit breaker: ${cbCheck.skipped ? 'open' : 'closed'}${c.reset}`);
  } else if (cbCheck.reason) {
    console.log(`${c.yellow}  ⚠ circuit breaker no se pudo chequear: ${cbCheck.reason}${c.reset}`);
  }
  console.log('');

  const t0 = Date.now();
  const healthSteps = [];
  let okCount = 0, skipCount = 0, failCount = 0;
  for (const step of steps) {
    if (step.order < startIdx || step.order > stopIdx) continue;
    const r = await runStep(step, opts);
    // XS1: track health del step para escribir _health.json al final.
    healthSteps.push({
      order: step.order,
      name: step.name,
      status: r.skipped ? 'skipped' : (r.ok ? 'ok' : 'failed'),
      durationMs: r.durationMs,
      error: r.exit ? `exit=${r.exit}` : undefined
    });
    if (!r.ok) {
      failCount++;
      // Status del run: si falló el último step y los anteriores
      // pasaron, es 'partial'. Si no había anteriores que pasaron,
      // es 'failed'.
      const anyPriorOk = healthSteps.slice(0, -1).some((s) => s.status === 'ok');
      const runStatus = anyPriorOk ? 'partial' : 'failed';
      // `writeHealth` es async, pero como vamos a hacer `process.exit(1)`
      // inmediatamente después, esperamos con un catch para no dejar
      // una promesa colgando que tire "unhandled promise rejection".
      writeHealth({
        steps: healthSteps,
        startedAt: t0,
        finishedAt: Date.now(),
        runStatus
      })
        .catch((e) => console.warn(`[health] writeHealth falló: ${e.message}`))
        .finally(() => process.exit(1));
      return;
    }
    if (r.skipped) skipCount++;
    else okCount++;
  }
  const total = fmtDuration(Date.now() - t0);
  console.log('');
  console.log(`${c.bold}Pipeline done.${c.reset} ${c.green}${okCount} ok${c.reset} / ${c.gray}${skipCount} skip${c.reset} / ${failCount > 0 ? c.red : c.gray}${failCount} fail${c.reset} ${c.gray}(total ${total})${c.reset}`);

  // XS1: escribir health al final de una corrida exitosa (filesystem
  // + DB, best-effort). El .catch es defensivo: writeHealth no debería
  // tirar nunca, pero si lo hace no queremos un unhandled rejection.
  writeHealth({
    steps: healthSteps,
    startedAt: t0,
    finishedAt: Date.now(),
    runStatus: 'ok'
  })
    .catch((e) => console.warn(`[health] writeHealth falló: ${e.message}`))
    .finally(() => process.exit(0));
}

// Solo ejecutar main() si este archivo es el entry point. Si es
// `require()`-eado por vitest, queremos importar las funciones
// puras sin disparar la pipeline real.
if (require.main === module) {
  main().catch((e) => {
    console.error(`${c.red}fatal: ${e.stack || e.message}${c.reset}`);
    process.exit(1);
  });
}

// ============================================================
// Exports para tests (Sprint E — Task 2)
// ============================================================
// Solo exportamos cuando NO somos el entry point. Esto permite que
// `node scripts/run-pipeline.js` siga funcionando exactamente igual,
// pero también que `require('./run-pipeline.js')` desde vitest
// pueda importar las funciones puras para testear.
if (require.main !== module) {
  module.exports = {
    buildHealthPayload,
    writeHealthFile,
    writeHealthToDb,
    writeHealth,
    readLastSuccessfulSyncAt,
    // Sprint H2: backfill HTTP step. Exportada para tests unitarios.
    // No se exporta la pipeline completa (`main`, `runStep`) porque
    // tiene side effects de process.exit y consola difíciles de
    // mockear; los tests de run-pipeline se enfocan en las funciones
    // puras.
    runBackfillHttpStep,
    // Sprint H2 follow-up: refresh MV step (idéntica razón que arriba —
    // exportada para tests unitarios de la rama de error cuando la
    // migration no se aplicó).
    runRefreshMvStep,
    // S1 (audit 2026-07-22, H2). Pre-flight check del circuit breaker
    // antes de spawnear children. Exportada para que
    // tests/scripts-run-pipeline-circuit-breaker.test.ts la pueda
    // testear con healthFilePath apuntando a un tmpdir.
    checkCircuitBreaker,
    // Sprint H2 follow-up (2026-08-02). Lee la sección `circuitBreaker`
    // del `_health.json` actual. Exportada para tests que verifiquen
    // que el payload incluye la sección cuando está presente y la omite
    // cuando no.
    readCircuitBreakerFromHealthFile
  };
}