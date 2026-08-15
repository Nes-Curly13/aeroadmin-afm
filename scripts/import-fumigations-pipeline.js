// Orchestrator: fetch fumigaciones desde DJI + upsert a dji_fumigations
// + backfill de parcel_id via moda de flights asociados.
//
// Uso:
//   node scripts/import-fumigations-pipeline.js
//   node scripts/import-fumigations-pipeline.js --skip-fetch
//   node scripts/import-fumigations-pipeline.js --skip-backfill

const { main: fetchFumigations } = require("./fetch-fumigations-from-djiag");
const { main: upsertFumigations } = require("./upsert-fumigations-from-djiag");
const { main: backfillFumigationParcel } = require("./backfill-fumigations-from-flights");

async function main() {
  const args = process.argv.slice(2);
  const skipFetch = args.includes("--skip-fetch");
  const skipBackfill = args.includes("--skip-backfill");

  if (!skipFetch) {
    console.log("[pipeline] 1/3 - fetch fumigaciones desde DJI");
    await fetchFumigations();
  } else {
    console.log("[pipeline] 1/3 - fetch skipped (usando fumigations.json existente)");
  }

  console.log("[pipeline] 2/3 - upsert a dji_fumigations");
  await upsertFumigations();

  // Step 3: backfill de parcel_id. El aggregate de DJI inserta con
  // parcel_id=NULL (es un agregado por dia, no sabe a que parcela
  // corresponde). Asignamos la parcela basandonos en la moda de los
  // flights asociados (que SI tienen parcel_id via spatial join).
  // Skip con --skip-backfill si queres solo fetch+upsert.
  if (!skipBackfill) {
    console.log("[pipeline] 3/3 - backfill parcel_id a fumigaciones aggregate");
    await backfillFumigationParcel();
  } else {
    console.log("[pipeline] 3/3 - backfill skipped");
  }

  console.log("[pipeline] DONE");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[pipeline] ERROR:", err);
    process.exit(1);
  });
}

module.exports = { main };
