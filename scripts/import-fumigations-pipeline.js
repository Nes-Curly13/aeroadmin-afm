// Orchestrator: fetch fumigaciones desde DJI + upsert a dji_fumigations.
//
// Uso:
//   node scripts/import-fumigations-pipeline.js
//   node scripts/import-fumigations-pipeline.js --skip-fetch

const { main: fetchFumigations } = require('./fetch-fumigations-from-djiag');
const { main: upsertFumigations } = require('./upsert-fumigations-from-djiag');

async function main() {
  const skipFetch = process.argv.includes('--skip-fetch');

  if (!skipFetch) {
    console.log('[pipeline] 1/2 — fetch fumigaciones desde DJI');
    await fetchFumigations();
  } else {
    console.log('[pipeline] 1/2 — fetch skipped (usando fumigations.json existente)');
  }

  console.log('[pipeline] 2/2 — upsert a dji_fumigations');
  await upsertFumigations();

  console.log('[pipeline] DONE');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[pipeline] ERROR:', err);
    process.exit(1);
  });
}

module.exports = { main };
