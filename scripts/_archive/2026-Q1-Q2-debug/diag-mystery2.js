// Mystery 2: sample more rows to understand the distribution
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  // Sample 20 rows randomly
  const r = await c.query("SELECT external_id, land_name, total_area_mu, position::text AS pos_text FROM dji_parcels ORDER BY random() LIMIT 20");
  console.log("Random sample of 20 rows:");
  r.rows.forEach((row) =>
    console.log(`  ext=${row.external_id.slice(-20)} land_name=${row.land_name === null ? "NULL" : `"${row.land_name}"`} total_area_mu=${row.total_area_mu} pos_text=${row.pos_text === null ? "NULL" : (row.pos_text.length > 20 ? "WKB" : `"${row.pos_text}"`)}`)
  );
  c.release();
  await p.end();
})();
