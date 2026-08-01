const { Client } = require("pg");
const fs = require("fs");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
const extId = "1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75";
const g = JSON.parse(fs.readFileSync("djiag_exports/land_files/" + extId + "_geometry.json", "utf-8"));
const pz = g.features.find((f) => f.properties.funcType === "PlantZone");
const pzJson = JSON.stringify(pz.geometry);
(async () => {
  await c.connect();
  // Sin ST_Buffer, solo ST_Multi + ST_Force2D
  const r = await c.query(
    "SELECT ST_NPoints(ST_Multi(ST_Force2D(ST_GeomFromGeoJSON($1::text)))) AS n, ST_Area(geography(ST_Multi(ST_Force2D(ST_GeomFromGeoJSON($1::text)))))::int AS area FROM (SELECT 1) x",
    [pzJson]
  );
  console.log("Sin ST_Buffer (ST_Multi+ST_Force2D):", r.rows[0]);
  c.end();
})();
