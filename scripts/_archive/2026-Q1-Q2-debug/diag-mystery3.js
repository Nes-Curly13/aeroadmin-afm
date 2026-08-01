// Same query as backfill script, standalone
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  const r = await c.query(`
    SELECT external_id, land_name, field_type, is_orchard,
           position::text AS pos_text, total_area_mu
    FROM dji_parcels
  `);
  console.log("Total rows:", r.rows.length);
  // First 3
  r.rows.slice(0, 3).forEach((row) =>
    console.log(`  ext=${row.external_id.slice(-20)} land_name=${row.land_name === null ? "NULL" : `"${row.land_name}"`} total_area_mu=${row.total_area_mu} pos_text=${row.pos_text === null ? "NULL" : (row.pos_text.length > 20 ? "WKB" : `"${row.pos_text}"`)}`)
  );
  // Count non-null
  const nonNull = r.rows.filter((row) => row.land_name !== null).length;
  console.log(`Rows with non-null land_name: ${nonNull}`);
  c.release();
  await p.end();
})();
