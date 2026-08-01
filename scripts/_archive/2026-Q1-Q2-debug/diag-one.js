const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  const r = await c.query(
    "SELECT land_name, ST_NPoints(spray_geom) AS n, ST_AsGeoJSON(spray_geom)::text AS g FROM dji_parcels WHERE external_id = $1",
    ["1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75"]
  );
  console.log("Docker ahora:", r.rows[0]);
  c.end();
})();
