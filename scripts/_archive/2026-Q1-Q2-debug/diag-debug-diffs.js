// Debug: check what the diff function sees for the first 3 parcels
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const { landToParcelParams } = require("../lib/djiag-lands-to-parcels");

(async () => {
  const lands = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json"), "utf-8")
  ).lands;

  const p = new Pool({
    connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
  });
  const c = await p.connect();

  for (const land of lands.slice(0, 3)) {
    const p_ = landToParcelParams(land);
    const r = await c.query(
      "SELECT external_id, land_name, is_orchard, field_type, total_area_mu, position::text AS pos_text FROM dji_parcels WHERE external_id = $1",
      [land.externalId]
    );
    const ex = r.rows[0];
    console.log(`\n=== ${land.name} (ext=${land.externalId.slice(-20)}) ===`);
    console.log(`  ex.land_name=${ex?.land_name}, p.landName=${p_.landName}`);
    console.log(`  ex.is_orchard=${ex?.is_orchard}, p.isOrchard=${p_.isOrchard}`);
    console.log(`  ex.field_type=${ex?.field_type}, p.fieldType=${p_.fieldType}`);
    console.log(`  ex.total_area_mu=${ex?.total_area_mu}, p.totalAreaMu=${p_.totalAreaMu}`);
    console.log(`  ex.pos_text=${ex?.pos_text}, p.positionWkt=${p_.positionWkt}`);
  }
  c.release();
  await p.end();
})();
