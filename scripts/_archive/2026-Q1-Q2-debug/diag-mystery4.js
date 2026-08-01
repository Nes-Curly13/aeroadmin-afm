// Same query as backfill script, with ORDER BY id
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  // Specific external_ids from backfill debug
  const ids = [
    "1268692918907510784-flyer-72b0e8-b57a153a60e5",  // land_name=1
    "1268692918907510784-flyer-f78d99-cb1e03e33008",  // land_name=GUACHICONA
    "1268692918907510784-flyer-738388-7cf96690df04",  // land_name=eden 7
  ];
  const r = await c.query(`
    SELECT id, external_id, land_name, field_type, is_orchard, total_area_mu, position::text AS pos_text
    FROM dji_parcels
    WHERE external_id = ANY($1)
    ORDER BY id
  `, [ids]);
  console.log("Rows for backfill's first 3 IDs:");
  r.rows.forEach((row) =>
    console.log(`  id=${row.id} ext=${row.external_id.slice(-30)} land_name=${row.land_name === null ? "NULL" : `"${row.land_name}"`} total_area_mu=${row.total_area_mu} pos_text=${row.pos_text === null ? "NULL" : (row.pos_text.length > 20 ? "WKB" : `"${row.pos_text}"`)}`)
  );
  c.release();
  await p.end();
})();
