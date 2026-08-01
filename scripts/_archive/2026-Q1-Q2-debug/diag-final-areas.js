const { Client, Pool } = require("pg");
const fs = require("fs");
fs.readFileSync(".env.local", "utf-8").split(/\r?\n/).forEach((l) => {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
});

(async () => {
  const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
  const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await docker.connect();
  const c = await sb.connect();
  const extId = "1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75";
  const r1 = await docker.query(
    "SELECT land_name, ST_NPoints(spray_geom) AS n, ST_Area(spray_geom::geography)::int AS area FROM dji_parcels WHERE external_id = $1",
    [extId]
  );
  const r2 = await c.query(
    "SELECT land_name, ST_NPoints(spray_geom) AS n, ST_Area(spray_geom::geography)::int AS area FROM dji_parcels WHERE external_id = $1",
    [extId]
  );
  console.log("LA_LINDA_LOTE_12 (7):");
  console.log("  docker:   ", r1.rows[0]);
  console.log("  supabase: ", r2.rows[0]);
  console.log("  source:   { n: 382, area: 10966 } (esperado)");
  const a1 = await docker.query(
    "SELECT count(*)::int AS n, sum(ST_Area(spray_geom::geography))::int AS total_area, avg(ST_Area(spray_geom::geography))::int AS avg_area FROM dji_parcels WHERE spray_geom IS NOT NULL"
  );
  const a2 = await c.query(
    "SELECT count(*)::int AS n, sum(ST_Area(spray_geom::geography))::int AS total_area, avg(ST_Area(spray_geom::geography))::int AS avg_area FROM dji_parcels WHERE spray_geom IS NOT NULL"
  );
  console.log("\nTotal área docker:  ", a1.rows[0]);
  console.log("Total área supabase:", a2.rows[0]);
  await docker.end();
  c.release();
  await sb.end();
})();
