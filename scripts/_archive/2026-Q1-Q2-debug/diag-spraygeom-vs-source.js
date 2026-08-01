#!/usr/bin/env node
// scripts/diag-spraygeom-vs-source.js
//
// Para 5 parcelas al azar, compara el spray_geom de BD con el PlantZone
// del geometry.json. Verifica que la geometría persistida es la misma
// que la fuente.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LAND_FILES_DIR = path.resolve(__dirname, "..", "djiag_exports", "land_files");

const c = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
});

function flattenPolygon(coords) {
  // coords is array of rings; ring is array of [lng, lat, alt?]
  const ring = coords[0];
  return ring.map(([lng, lat]) => [+lng, +lat]);
}

function polygonEquals(a, b, tol = 1e-9) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i][0] - b[i][0]) > tol) return false;
    if (Math.abs(a[i][1] - b[i][1]) > tol) return false;
  }
  return true;
}

(async () => {
  await c.connect();

  // Tomar 5 parcelas con spray_geom populado
  const samples = await c.query(`
    SELECT id, external_id, land_name, spray_geom, raw_geometry
    FROM dji_parcels
    WHERE spray_geom IS NOT NULL AND external_id IS NOT NULL
    ORDER BY id
    LIMIT 5
  `);

  console.log(`Comparando ${samples.rows.length} parcelas:\n`);

  for (const row of samples.rows) {
    console.log(`=== Parcel id=${row.id} ext=${row.external_id.slice(-20)} ===`);
    console.log(`  land_name: ${row.land_name}`);

    // Cargar land_file correspondiente
    const landFile = path.join(
      LAND_FILES_DIR,
      `${row.external_id}_geometry.json`
    );
    if (!fs.existsSync(landFile)) {
      console.log(`  [NO LAND FILE] ${landFile}`);
      continue;
    }
    const geo = JSON.parse(fs.readFileSync(landFile, "utf-8"));
    const plantZone = geo.features.find(
      (f) => f?.properties?.funcType === "PlantZone" && f.geometry
    );
    if (!plantZone) {
      console.log(`  [NO PlantZone en land_file]`);
      continue;
    }

    const plantZoneRing = flattenPolygon(plantZone.geometry.coordinates);
    const plantZoneVerts = plantZoneRing.length;

    // Obtener coords del spray_geom de BD
    const dbRing = await c.query(
      `SELECT ST_AsGeoJSON(spray_geom)::json AS g FROM dji_parcels WHERE id = $1`,
      [row.id]
    );
    const dbGeom = dbRing.rows[0].g;
    let dbRings = [];
    if (dbGeom.type === "MultiPolygon") {
      dbRings = dbGeom.coordinates[0]; // primer polígono del multi
    } else if (dbGeom.type === "Polygon") {
      dbRings = dbGeom.coordinates;
    } else {
      console.log(`  [BD TIENE TIPO INESPERADO: ${dbGeom.type}]`);
      continue;
    }
    const dbCoords = dbRings[0].map(([lng, lat]) => [+lng, +lat]);
    const dbVerts = dbCoords.length;

    console.log(`  PlantZone (source): ${plantZoneVerts} vértices`);
    console.log(`  spray_geom (BD):    ${dbVerts} vértices`);

    if (plantZoneVerts === dbVerts) {
      // Comparar vértices
      const allMatch = polygonEquals(plantZoneRing, dbCoords);
      if (allMatch) {
        console.log(`  ✓ MATCH EXACTO`);
      } else {
        // Buscar primer mismatch
        for (let i = 0; i < dbCoords.length; i++) {
          if (
            Math.abs(plantZoneRing[i][0] - dbCoords[i][0]) > 1e-9 ||
            Math.abs(plantZoneRing[i][1] - dbCoords[i][1]) > 1e-9
          ) {
            console.log(
              `  ✗ DIFIERE en vértice ${i}: src=[${plantZoneRing[i][0]}, ${plantZoneRing[i][1]}] db=[${dbCoords[i][0]}, ${dbCoords[i][1]}]`
            );
            break;
          }
        }
      }
    } else {
      console.log(
        `  ⚠ Distinto número de vértices (source ${plantZoneVerts} vs BD ${dbVerts})`
      );
      console.log(
        `    Posible causa: simplificación / reverse / wrap en import`
      );
      // Verificar si son los mismos vértices en otro orden
      const first = plantZoneRing[0];
      const idxInDb = dbCoords.findIndex(
        (p) => Math.abs(p[0] - first[0]) < 1e-9 && Math.abs(p[1] - first[1]) < 1e-9
      );
      if (idxInDb >= 0) {
        console.log(`    Primer vértice source encontrado en BD en posición ${idxInDb}`);
      } else {
        console.log(`    Primer vértice source NO está en BD`);
      }
    }
    console.log();
  }

  await c.end();
})();
