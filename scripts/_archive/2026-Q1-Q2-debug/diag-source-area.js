const { Client } = require("pg");
const fs = require("fs");

const extId = "1268692918907510784-flyer-c0708598-16cc-4078-8324-97044df9da75";
const g = JSON.parse(fs.readFileSync("djiag_exports/land_files/" + extId + "_geometry.json", "utf-8"));
const pz = g.features.find((f) => f.properties.funcType === "PlantZone");
const pzJson = JSON.stringify(pz.geometry);

const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();
  // 1. Just ST_GeomFromGeoJSON, no ST_Buffer
  const r1 = await c.query("SELECT ST_NPoints(ST_GeomFromGeoJSON($1::text)) AS n, ST_Area(ST_GeomFromGeoJSON($1::text)::geography)::int AS area FROM (SELECT 1) x", [pzJson]);
  console.log("ST_GeomFromGeoJSON (no buffer):", r1.rows[0]);

  // 2. With ST_Buffer(0)
  const r2 = await c.query("SELECT ST_NPoints(ST_Buffer(ST_GeomFromGeoJSON($1::text), 0)) AS n, ST_Area(ST_Buffer(ST_GeomFromGeoJSON($1::text)::geography, 0))::int AS area FROM (SELECT 1) x", [pzJson]);
  console.log("ST_Buffer(0):", r2.rows[0]);

  // 3. With ST_Force2D first
  const r3 = await c.query("SELECT ST_NPoints(ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON($1::text)), 0))) AS n, ST_Area(ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON($1::text))::geography, 0)))::int AS area FROM (SELECT 1) x", [pzJson]);
  console.log("ST_Multi+ST_Buffer+ST_Force2D(0):", r3.rows[0]);

  // 4. Without ST_Buffer, just ST_Multi+ST_Force2D
  const r4 = await c.query("SELECT ST_NPoints(ST_Multi(ST_Force2D(ST_GeomFromGeoJSON($1::text)))) AS n, ST_Area(ST_Multi(ST_Force2D(ST_GeomFromGeoJSON($1::text))::geography))::int AS area FROM (SELECT 1) x", [pzJson]);
  console.log("ST_Multi+ST_Force2D (no buffer):", r4.rows[0]);

  c.end();
})();
