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

function runStep(step, opts) {
  const tag = `${c.cyan}[${step.order}/10]${c.reset} ${c.bold}${step.name}${c.reset}`;
  if (step.skip && step.skip()) {
    console.log(`${tag} ${c.gray}— skip (${step.skipReason ? step.skipReason() : 'flag'})${c.reset}`);
    return { ok: true, skipped: true };
  }
  const cmdStr = `${c.dim}node ${step.cmd.join(' ')}${c.reset}`;
  console.log(`\n${tag}\n  ${cmdStr}`);
  if (opts.dryRun) {
    console.log(`  ${c.yellow}[dry-run] no ejecutado${c.reset}`);
    return { ok: true, skipped: true };
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
    return { ok: true };
  }
  console.error(`  ${c.red}✗ exit=${r.status} signal=${r.signal ?? '-'} dur=${dur}${c.reset}`);
  console.error(`  ${c.red}step ${step.order} (${step.name}) falló — pipeline abortada${c.reset}`);
  return { ok: false, exit: r.status };
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
  let okCount = 0, skipCount = 0, failCount = 0;
  for (const step of steps) {
    if (step.order < startIdx || step.order > stopIdx) continue;
    const r = runStep(step, opts);
    if (!r.ok) {
      failCount++;
      process.exit(1);
    }
    if (r.skipped) skipCount++;
    else okCount++;
  }
  const total = fmtDuration(Date.now() - t0);
  console.log('');
  console.log(`${c.bold}Pipeline done.${c.reset} ${c.green}${okCount} ok${c.reset} / ${c.gray}${skipCount} skip${c.reset} / ${failCount > 0 ? c.red : c.gray}${failCount} fail${c.reset} ${c.gray}(total ${total})${c.reset}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`${c.red}fatal: ${e.stack || e.message}${c.reset}`);
  process.exit(1);
});