// Orchestrator: fetch lands desde DJI + upsert a dji_parcels, en una sola corrida.
//
// Uso:
//   node scripts/import-lands-pipeline.js
//   node scripts/import-lands-pipeline.js --skip-fetch   # si ya tenés djiag_exports/lands.json
//
// Si el fetch falla, NO se hace upsert (la data en disco puede ser vieja).
// Si el upsert falla, los lands.json quedan en disco (reintentables).

const { main: fetchLands } = require('./fetch-lands-from-djiag');
const { main: upsertLands } = require('./upsert-lands-from-djiag');

async function main() {
  const skipFetch = process.argv.includes('--skip-fetch');

  if (!skipFetch) {
    console.log('[pipeline] 1/2 — fetch lands desde DJI');
    await fetchLands();
  } else {
    console.log('[pipeline] 1/2 — fetch skipped (usando lands.json existente)');
  }

  console.log('[pipeline] 2/2 — upsert a dji_parcels');
  await upsertLands();

  console.log('[pipeline] DONE');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[pipeline] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main };
