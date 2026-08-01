const { Client } = require("pg");
const fs = require("fs");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
const extId = "1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75";
const g = JSON.parse(fs.readFileSync("djiag_exports/land_files/" + extId + "_geometry.json", "utf-8"));
const pz = g.features.find(f => f.properties.funcType === "PlantZone");
const pzJson = JSON.stringify(pz.geometry);
(async () => {
  await c.connect();
  const r = await c.query(
    "UPDATE dji_parcels SET spray_geom = ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON($1::text)), 0)) WHERE external_id = $2 RETURNING ST_NPoints(spray_geom) AS n",
    [pzJson, extId]
  );
  console.log("Update RETURNING n:", r.rows[0]);
  const r2 = await c.query("SELECT ST_NPoints(spray_geom) AS n FROM dji_parcels WHERE external_id = $1", [extId]);
  console.log("Re-read n:", r2.rows[0]);
  c.end();
})();
