// CLI: ejecuta la pipeline DJI AG end-to-end.
//
// Steps (en orden):
//   1. Scrape per-flight records (Playwright + UI)          → djiag_exports/perflight_records.json
//   2. Scrape fumigations aggregate (Playwright + UI)        → djiag_exports/fumigations.json
//   3. Upsert flights                                         → dji_flights
//   4. Spatial join flights × parcels (fill parcel_id)        → dji_flights.parcel_id
//   5. Upsert fumigations aggregate                           → dji_fumigations (source='dji_aggr')
//   6. Backfill per-parcel fumigations from flights           → dji_fumigations (source='import')
//   7. Update fumigation schedule (last_fumigation_date / next_due_date)
//   8. Fetch lands from DJI (GraphQL)                         → djiag_exports/lands.json
//   9. Download land assets (signed S3, ~12h TTL)            → djiag_exports/land_files/
//  10. Upsert lands into dji_parcels                          → dji_parcels (API columns)
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
//   --start-from STEP   arranca desde un step (1-10, nombre también)
//   --stop-at STEP      para después de un step (1-10, nombre también)
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

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  const out = { days: 30, tolerance: 500, skipScrape: false, skipFetchLands: false, skipDownloadAssets: false, dryRun: false, startFrom: null, stopAt: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') out.days = Number(argv[++i]) || out.days;
    else if (a === '--tolerance') out.tolerance = Number(argv[++i]) || out.tolerance;
    else if (a === '--skip-scrape') out.skipScrape = true;
    else if (a === '--skip-fetch-lands') out.skipFetchLands = true;
    else if (a === '--skip-download-assets') out.skipDownloadAssets = true;
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

// Steps. order = 1-based, name = human label, cmd = [script, ...args], optional = skip condition.
//   optional(skipScrape) = true → step se skipea si --skip-scrape.
//   optional(skipFetchLands) = true → step se skipea si --skip-fetch-lands.
//   optional(skipDownloadAssets) = true → step se skipea si --skip-download-assets.
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
      name: 'backfill per-parcel fumigations',
      cmd: ['scripts/backfill-fumigations-from-flights.js'],
      skip: () => false,
    },
    {
      order: 7,
      name: 'update fumigation schedule',
      cmd: ['scripts/update-fumigation-schedule.js'],
      skip: () => false,
    },
    {
      order: 8,
      name: 'fetch lands',
      cmd: ['scripts/fetch-lands-from-djiag.js', '--days', String(opts.days)],
      skip: () => opts.skipFetchLands,
      skipReason: () => '--skip-fetch-lands',
    },
    {
      order: 9,
      name: 'download land assets',
      cmd: ['scripts/download-land-assets.js'],
      skip: () => opts.skipDownloadAssets,
      skipReason: () => '--skip-download-assets',
    },
    {
      order: 10,
      name: 'upsert lands',
      cmd: ['scripts/upsert-lands-from-djiag.js'],
      skip: () => opts.skipFetchLands,
      skipReason: () => '--skip-fetch-lands',
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
 */
function buildHealthPayload({ steps, finishedAt, runStatus, prevLastSuccessfulSyncAt }) {
  const totals = { flights: 0, fumigations: 0, lands: 0 };
  for (const s of steps) {
    if (s.status !== 'ok') continue;
    if (s.name.includes('upsert flights')) totals.flights += 1;
    else if (s.name.includes('upsert fumigations')) totals.fumigations += 1;
    else if (s.name.includes('upsert lands')) totals.lands += 1;
  }
  const lastSuccessfulSyncAt =
    runStatus === 'ok' ? new Date(finishedAt).toISOString() : (prevLastSuccessfulSyncAt ?? null);
  return {
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
    await pool.query(
      `INSERT INTO public.djiag_health (
        id, last_run_at, last_run_status, last_successful_sync_at,
        flights_count, fumigations_count, lands_count, steps, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET
        last_run_at = EXCLUDED.last_run_at,
        last_run_status = EXCLUDED.last_run_status,
        last_successful_sync_at = COALESCE(EXCLUDED.last_successful_sync_at, public.djiag_health.last_successful_sync_at),
        flights_count = EXCLUDED.flights_count,
        fumigations_count = EXCLUDED.fumigations_count,
        lands_count = EXCLUDED.lands_count,
        steps = EXCLUDED.steps,
        updated_at = now()`,
      [
        1,
        payload.lastRunAt,
        payload.lastRunStatus,
        payload.lastSuccessfulSyncAt,
        payload.totals.flights,
        payload.totals.fumigations,
        payload.totals.lands,
        JSON.stringify(payload.steps)
      ]
    );
    if (process.env.DEBUG_PIPELINE) {
      console.error(`[health] wrote djiag_health (status=${payload.lastRunStatus}, steps=${payload.steps.length})`);
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
 * Orquestador: construye el payload y lo escribe a filesystem + DB.
 * Si el filesystem write falla, el DB write sigue intentando (y
 * viceversa). Best-effort, no rompe el pipeline.
 */
async function writeHealth({ steps, startedAt, finishedAt, runStatus }) {
  // `startedAt` se conserva en la firma por compat con callers
  // previos, pero no se usa en el payload (solo finishedAt importa
  // para lastRunAt/lastSuccessfulSyncAt).
  void startedAt;
  const prevLastSuccessfulSyncAt = readLastSuccessfulSyncAt();
  const payload = buildHealthPayload({
    steps,
    finishedAt,
    runStatus,
    prevLastSuccessfulSyncAt
  });
  // Filesystem write (síncrono, no puede tirar async).
  writeHealthFile(payload);
  // DB write (async, best-effort).
  await writeHealthToDb(payload);
}

function runStep(step, opts) {
  const tag = `${c.cyan}[${step.order}/10]${c.reset} ${c.bold}${step.name}${c.reset}`;
  if (step.skip && step.skip()) {
    console.log(`${tag} ${c.gray}— skip (${step.skipReason ? step.skipReason() : 'flag'})${c.reset}`);
    return { ok: true, skipped: true, durationMs: 0 };
  }
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
  const { startIdx, stopIdx } = resolveRange(steps, opts.startFrom, opts.stopAt);

  console.log(`${c.bold}AeroAdmin AFM — DJI pipeline runner${c.reset}`);
  console.log(`${c.gray}  days=${opts.days} tolerance=${opts.tolerance}m dryRun=${opts.dryRun}${c.reset}`);
  console.log(`${c.gray}  range: step ${startIdx} → ${stopIdx}${c.reset}`);
  console.log('');

  const t0 = Date.now();
  const healthSteps = [];
  let okCount = 0, skipCount = 0, failCount = 0;
  for (const step of steps) {
    if (step.order < startIdx || step.order > stopIdx) continue;
    const r = runStep(step, opts);
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
    readLastSuccessfulSyncAt
  };
}