// Quick check: for GUACHICONA parcel, compare BD state vs API state.
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

(async () => {
  const lands = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json"), "utf-8")
  ).lands;
  const land = lands.find((l) => l.name === "GUACHICONA");

  const p = new Pool({
    connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
  });
  const c = await p.connect();
  const r = await c.query(
    "SELECT external_id, land_name, is_orchard, field_type, total_area_mu, position::text AS pos, bbox::text AS bbox_text, tags, serial_number, dji_land_uuid FROM dji_parcels WHERE external_id = $1",
    [land.externalId]
  );
  console.log("BD state for GUACHICONA:");
  console.log(JSON.stringify(r.rows[0], null, 2));
  console.log("\nAPI state for GUACHICONA:");
  console.log(
    JSON.stringify(
      {
        name: land.name,
        landType: land.landType,
        totalAreaMu: land.totalAreaMu,
        position: land.position,
        bbox: land.bbox,
        tags: land.tags,
        serialNumber: land.serialNumber,
        uuid: land.uuid,
      },
      null,
      2
    )
  );
  c.release();
  await p.end();
})();
