#!/usr/bin/env node
// scripts/diag-polygons-shape.js
//
// Para 5 parcelas, calcula área y centroide de:
//   1. PlantZone en geometry.json (source)
//   2. spray_geom en dji_parcels (BD)
// Y verifica si difieren solo por rotación de vértices.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LAND_FILES_DIR = path.resolve(__dirname, "..", "djiag_exports", "land_files");

const c = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
});

function flattenPolygon(coords) {
  const ring = coords[0];
  return ring.map(([lng, lat]) => [+lng, +lat]);
}

function polygonArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosLat;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * mPerDegLng * ring[i][1] * mPerDegLat -
         ring[i][0] * mPerDegLng * ring[j][1] * mPerDegLat;
  }
  return Math.abs(a) / 2;
}

function polygonCentroid(ring) {
  const n = ring.length - 1; // último == primero
  let cx = 0,
    cy = 0,
    A = 0;
  for (let i = 0; i < n; i++) {
    const x0 = ring[i][0],
      y0 = ring[i][1];
    const x1 = ring[i + 1][0],
      y1 = ring[i + 1][1];
    const f = x0 * y1 - x1 * y0;
    A += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  A *= 0.5;
  cx /= 6 * A;
  cy /= 6 * A;
  return [cx, cy];
}

function vertexSetEquals(a, b, tol = 1e-7) {
  if (a.length !== b.length) return false;
  const setB = new Set(b.map(([x, y]) => `${x.toFixed(7)},${y.toFixed(7)}`));
  for (const [x, y] of a) {
    const k = `${x.toFixed(7)},${y.toFixed(7)}`;
    if (!setB.has(k)) return false;
  }
  return true;
}

(async () => {
  await c.connect();

  const samples = await c.query(`
    SELECT id, external_id
    FROM dji_parcels
    WHERE spray_geom IS NOT NULL AND external_id IS NOT NULL
    ORDER BY id
    LIMIT 5
  `);

  for (const row of samples.rows) {
    const extId = row.external_id;
    const landFile = path.join(LAND_FILES_DIR, `${extId}_geometry.json`);
    if (!fs.existsSync(landFile)) {
      console.log(`id=${row.id} ext=${extId.slice(-20)} [no land_file]`);
      continue;
    }
    const geo = JSON.parse(fs.readFileSync(landFile, "utf-8"));
    const plantZone = geo.features.find(
      (f) => f?.properties?.funcType === "PlantZone" && f.geometry
    );
    if (!plantZone) {
      console.log(`id=${row.id} [no PlantZone]`);
      continue;
    }

    const srcRing = flattenPolygon(plantZone.geometry.coordinates);
    const srcArea = polygonArea(srcRing);
    const srcCentroid = polygonCentroid(srcRing);

    const dbR = await c.query(
      `SELECT ST_AsGeoJSON(spray_geom)::json AS g, ST_Area(spray_geom::geography) AS area_m2 FROM dji_parcels WHERE id = $1`,
      [row.id]
    );
    const dbGeom = dbR.rows[0].g;
    const dbRings =
      dbGeom.type === "MultiPolygon" ? dbGeom.coordinates[0] : dbGeom.coordinates;
    const dbRing = dbRings[0].map(([lng, lat]) => [+lng, +lat]);
    const dbArea = polygonArea(dbRing);
    const dbCentroid = polygonCentroid(dbRing);
    const dbAreaPostgis = parseFloat(dbR.rows[0].area_m2);

    console.log(`\n=== id=${row.id} ext=${extId.slice(-20)} ===`);
    console.log(
      `  Source (geometry.json): ${srcRing.length} verts, area=${(srcArea / 10000).toFixed(4)} ha, centroid=[${srcCentroid[0].toFixed(6)}, ${srcCentroid[1].toFixed(6)}]`
    );
    console.log(
      `  BD (dji_parcels):       ${dbRing.length} verts, area=${(dbArea / 10000).toFixed(4)} ha, centroid=[${dbCentroid[0].toFixed(6)}, ${dbCentroid[1].toFixed(6)}]`
    );
    console.log(
      `  BD PostGIS (geography): area=${(dbAreaPostgis / 10000).toFixed(4)} ha`
    );

    // Mismos vértices (set equality)?
    const sameSet = vertexSetEquals(srcRing, dbRing);
    console.log(`  ¿Mismos vértices (set)?      ${sameSet ? "SÍ" : "NO"}`);

    // Si difieren, ¿es por rotación de vértices?
    if (!sameSet) {
      const first = srcRing[0];
      const idxInDb = dbRing.findIndex(
        ([x, y]) => Math.abs(x - first[0]) < 1e-7 && Math.abs(y - first[1]) < 1e-7
      );
      console.log(`  source v0 en posición BD:    ${idxInDb} (de ${dbRing.length - 1})`);
    }
  }

  await c.end();
})();
