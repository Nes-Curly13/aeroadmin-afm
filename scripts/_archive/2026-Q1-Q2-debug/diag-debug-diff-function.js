// Debug: directly test the diff function for 1 parcel
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { landToParcelParams } = require("../lib/djiag-lands-to-parcels");

// Replicate diffRow inline with debug
function diffRow(existing, p) {
  const diffs = [];
  console.log("  diffRow input:");
  console.log(`    existing.land_name (type ${typeof existing.land_name}) =`, existing.land_name);
  console.log(`    p.landName (type ${typeof p.landName}) =`, p.landName);
  console.log(`    check: existing.land_name === null && p.landName !== null →`, existing.land_name === null && p.landName !== null);

  if (existing.land_name === null && p.landName !== null) {
    diffs.push({ field: "land_name", from: null, to: p.landName });
  }
  if (existing.is_orchard !== p.isOrchard) {
    diffs.push({ field: "is_orchard", from: existing.is_orchard, to: p.isOrchard });
  }
  if (existing.field_type !== p.fieldType) {
    diffs.push({ field: "field_type", from: existing.field_type, to: p.fieldType });
  }
  if (existing.total_area_mu === null && p.totalAreaMu !== null) {
    diffs.push({ field: "total_area_mu", from: null, to: p.totalAreaMu });
  }
  if (existing.pos_text === null && p.positionWkt !== null) {
    diffs.push({ field: "position", from: null, to: p.positionWkt });
  }
  return diffs;
}

(async () => {
  const lands = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json"), "utf-8")
  ).lands;
  const land = lands[0]; // GUACHICONA

  const p_ = landToParcelParams(land);

  const pool = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  const c2 = await pool.connect();
  const r = await c2.query(
    "SELECT external_id, land_name, is_orchard, field_type, total_area_mu, position::text AS pos_text FROM dji_parcels WHERE external_id = $1",
    [land.externalId]
  );
  const ex = r.rows[0];

  console.log("Calling diffRow for GUACHICONA...");
  const diffs = diffRow(ex, p_);
  console.log("\nDiffs found:", diffs);

  c2.release();
  await pool.end();
})().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
