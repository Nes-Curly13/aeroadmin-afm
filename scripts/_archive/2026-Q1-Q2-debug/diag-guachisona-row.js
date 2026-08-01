// Check current state of GUACHICONA's row directly
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  const r = await c.query(
    "SELECT id, external_id, land_name, field_type, is_orchard, total_area_mu, position::text AS pos_text, source_url_geometry FROM dji_parcels WHERE external_id = '1268692918907510784-flyer-ad92e206-4679-4fb5-81c5-3ee5230faa08'"
  );
  console.log("GUACHICONA row:", JSON.stringify(r.rows[0], null, 2));
  c.release();
  await p.end();
})();
