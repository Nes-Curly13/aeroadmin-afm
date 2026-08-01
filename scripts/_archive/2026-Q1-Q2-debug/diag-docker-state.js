// Verificar el estado actual del docker: polígonos + metadata + consistencia
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LAND_FILES = path.resolve(__dirname, "..", "djiag_exports", "land_files");
const LANDS_NORM = path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json");

const lands = JSON.parse(fs.readFileSync(LANDS_NORM, "utf-8")).lands;
const landsByExtId = new Map();
for (const l of lands) if (l.externalId) landsByExtId.set(l.externalId, l);

const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });

(async () => {
  await c.connect();

  // 1. Conteos
  const counts = await c.query(`
    SELECT
      count(*)::int AS total,
      count(land_name)::int AS with_land_name,
      count(position)::int AS with_position,
      count(bbox)::int AS with_bbox,
      count(spray_geom)::int AS with_spray_geom,
      count(reference_point)::int AS with_reference_point,
      count(total_area_mu)::int AS with_total_area_mu,
      count(dji_land_uuid)::int AS with_uuid,
      count(spray_area_m2)::int AS with_spray_area_m2,
      count(drone_model_code)::int AS with_drone
    FROM dji_parcels
  `);
  console.log("=== Conteos docker ===");
  console.log(JSON.stringify(counts.rows[0], null, 2));

  // 2. Consistencia polígono vs source (5 random)
  const samples = await c.query(`
    SELECT id, external_id, land_name,
           ST_AsGeoJSON(spray_geom)::json AS spray_geom_geojson,
           ST_NPoints(spray_geom) AS n_points,
           ST_Area(spray_geom::geography)::int AS area_m2
    FROM dji_parcels
    WHERE spray_geom IS NOT NULL AND land_name IS NOT NULL
    ORDER BY random()
    LIMIT 5
  `);

  console.log("\n=== Match polígono vs source (5 random) ===");
  let allMatch = true;
  for (const row of samples.rows) {
    const landFile = path.join(LAND_FILES, `${row.external_id}_geometry.json`);
    if (!fs.existsSync(landFile)) {
      console.log(`  id=${row.id} ext=${row.external_id.slice(-20)} ⚠ NO LAND FILE`);
      allMatch = false;
      continue;
    }
    const geo = JSON.parse(fs.readFileSync(landFile, "utf-8"));
    const pz = geo.features.find((f) => f?.properties?.funcType === "PlantZone");
    if (!pz) {
      console.log(`  id=${row.id} ext=${row.external_id.slice(-20)} ⚠ NO PlantZone`);
      allMatch = false;
      continue;
    }
    const srcVerts = pz.geometry.coordinates[0]?.length ?? 0;
    const dbVerts = row.n_points;
    const status = srcVerts === dbVerts ? "✓" : "✗";
    if (srcVerts !== dbVerts) allMatch = false;
    console.log(`  ${status} id=${row.id} "${row.land_name}": source=${srcVerts}v / BD=${dbVerts}v, area=${(row.area_m2 / 10000).toFixed(4)} ha`);
  }

  // 3. Orchard consistency
  const all = await c.query(`SELECT external_id, is_orchard, field_type FROM dji_parcels`);
  let consistent = 0, inconsistent = 0, noDji = 0;
  for (const row of all.rows) {
    const dji = landsByExtId.get(row.external_id);
    if (!dji) { noDji++; continue; }
    const djiIsOrchard = dji.landType === "Orchards";
    if (row.is_orchard === djiIsOrchard) consistent++;
    else inconsistent++;
  }
  console.log("\n=== Orchard consistency ===");
  console.log(`  Consistente:  ${consistent}`);
  console.log(`  Inconsistente: ${inconsistent}`);
  console.log(`  Sin match DJI: ${noDji}`);

  console.log("\n=== Resumen ===");
  console.log(`  Polígonos match con source: ${allMatch ? "SÍ" : "NO"}`);
  console.log(`  Orchard consistency:        ${inconsistent === 0 ? "OK" : `⚠ ${inconsistent} inconsistencias`}`);

  await c.end();
})();
