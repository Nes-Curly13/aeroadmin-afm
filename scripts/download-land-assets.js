// CLI: descarga los assets (geometry/parameter/waypoint) de las fincas
// scrapeadas en djiag_exports/lands.json a djiag_exports/land_files/.
//
// Pipeline esperado:
//   1. node scripts/fetch-lands-from-djiag.js  →  djiag_exports/lands.json
//   2. node scripts/download-land-assets.js   →  djiag_exports/land_files/*
//   3. node import_djiag_data.js              →  dji_parcels (PostGIS)
//
// Uso:
//   node scripts/download-land-assets.js
//   node scripts/download-land-assets.js --max-lands 10        # testing
//   node scripts/download-land-assets.js --dry-run              # ver URLs
//   node scripts/download-land-assets.js --force               # re-bajar todo
//   node scripts/download-land-assets.js --kinds geometry,parameter  # subset
//
// Variables de entorno:
//   (ninguna requerida — fetch público a signed URLs S3 de DJI)

const fs = require('fs');
const path = require('path');
const {
  runDownload,
  buildAssetIndex,
  DEFAULT_KINDS
} = require('../lib/djiag-asset-downloader');

function parseArgs(argv) {
  const out = {
    in: path.join(process.cwd(), 'djiag_exports', 'lands.json'),
    outDir: path.join(process.cwd(), 'djiag_exports', 'land_files'),
    kinds: DEFAULT_KINDS.slice(),
    concurrency: 4,
    timeoutMs: 30000,
    retries: 3,
    force: false,
    maxLands: null,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = path.resolve(argv[++i]);
    else if (a === '--out-dir') out.outDir = path.resolve(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]) || out.concurrency;
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    else if (a === '--retries') out.retries = Number(argv[++i]) || out.retries;
    else if (a === '--kinds') out.kinds = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--force') out.force = true;
    else if (a === '--max-lands') out.maxLands = Number(argv[++i]) || null;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
    else {
      console.error(`flag desconocido: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return out;
}

function printHelp() {
  console.log(`\
Uso: node scripts/download-land-assets.js [flags]

Descarga geometry/parameter/waypoint de cada land en lands.json a land_files/.

Flags:
  --in PATH           lands.json (default: djiag_exports/lands.json)
  --out-dir PATH      output directory (default: djiag_exports/land_files)
  --kinds LIST        comma-separated: geometry,parameter,waypoint (default: all)
  --concurrency N     requests paralelos (default: 4)
  --timeout-ms N      fetch timeout por request (default: 30000)
  --retries N         reintentos por URL (default: 3)
  --force             re-descargar aunque el archivo ya exista
  --max-lands N       solo las primeras N fincas (testing)
  --dry-run           listar URLs planeadas sin descargar
  -h, --help          esta ayuda
`);
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!fs.existsSync(opts.in)) {
    throw new Error(`No se encontró ${opts.in}. Corré primero: npm run fetch:djiag:lands`);
  }

  const raw = fs.readFileSync(opts.in, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${opts.in} no es JSON válido: ${err.message}`);
  }
  const lands = Array.isArray(data) ? data : (data.lands ?? []);
  if (!Array.isArray(lands) || lands.length === 0) {
    throw new Error(`${opts.in} no contiene lands (array vacío).`);
  }

  let selected = lands;
  if (opts.maxLands) selected = selected.slice(0, opts.maxLands);

  console.log(`[download-land-assets] input:  ${path.relative(process.cwd(), opts.in)} (${lands.length} lands total)`);
  console.log(`[download-land-assets] output: ${path.relative(process.cwd(), opts.outDir)}`);
  console.log(`[download-land-assets] scope:  ${selected.length} lands × kinds=[${opts.kinds.join(',')}]  concurrency=${opts.concurrency} timeout=${opts.timeoutMs}ms retries=${opts.retries}`);

  if (opts.dryRun) {
    const tasks = buildAssetIndex(selected, opts.kinds);
    console.log(`[dry-run] ${tasks.length} downloads programados:`);
    for (const t of tasks.slice(0, 5)) {
      const path = `${t.externalId.slice(0, 30)}.../${t.kind}`;
      console.log(`  ${path.padEnd(40)} ← ${t.url.slice(0, 100)}`);
    }
    if (tasks.length > 5) console.log(`  ... y ${tasks.length - 5} más`);
    return;
  }

  const t0 = Date.now();
  const stats = await runDownload({
    lands: selected,
    outDir: opts.outDir,
    kinds: opts.kinds,
    concurrency: opts.concurrency,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
    force: opts.force,
    logger: { warn: (msg) => console.warn(msg) }
  });
  const dur = fmtDuration(Date.now() - t0);

  console.log('');
  console.log(`[download-land-assets] done in ${dur}`);
  console.log(`  total:      ${stats.total}`);
  console.log(`  downloaded: ${stats.downloaded}`);
  console.log(`  skipped:    ${stats.skipped}  (ya existían — usar --force para re-bajar)`);
  console.log(`  failed:     ${stats.failed}`);
  console.log(`  bytes:      ${fmtBytes(stats.bytes)}`);

  if (stats.failed > 0) {
    console.error('');
    console.error(`[download-land-assets] ${stats.failed} fallos. Primeros:`);
    for (const e of stats.errors.slice(0, 5)) {
      console.error(`  ${e.externalId}/${e.kind}: ${e.error}`);
    }
    if (stats.errors.length > 5) {
      console.error(`  ... y ${stats.errors.length - 5} más.`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[download-land-assets] FATAL:', err.stack || err.message);
  process.exit(1);
});

module.exports = { main, parseArgs };