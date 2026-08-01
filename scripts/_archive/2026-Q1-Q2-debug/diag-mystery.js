// Mystery: count says 0 with_land_name, but SELECT returns non-null
const { Pool } = require("pg");
const p = new Pool({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  const c = await p.connect();
  // First: count
  const c1 = await c.query("SELECT count(*)::int AS total, count(land_name)::int AS with_land_name FROM dji_parcels");
  console.log("count result:", JSON.stringify(c1.rows[0]));
  // Then: select
  const c2 = await c.query("SELECT external_id, land_name FROM dji_parcels ORDER BY id LIMIT 5");
  console.log("select result:");
  c2.rows.forEach((r) => console.log(`  ext=${r.external_id.slice(-20)} land_name=${r.land_name}`));
  c.release();
  await p.end();
})();
