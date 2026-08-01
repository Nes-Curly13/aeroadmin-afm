#!/usr/bin/env node
// scripts/diag-polygons-vs-source.js
//
// Compara spray_geom (PostGIS) vs geometry.json (DJI source) para todas
// las parcelas. Confirma si el polígono de BD es realmente el PlantZone.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LAND_FILES_DIR = path.resolve(__dirname, "..", "djiag_exports", "land_files");
const LANDS_NORMALIZED = path.resolve(
  __dirname,
  "..",
  "djiag_exports",
  "lands-normalized.json"
);

// Carga data normalizada (lands-normalized.json)
const landsNorm = JSON.parse(fs.readFileSync(LANDS_NORMALIZED, "utf-8"));
const landsByExtId = new Map();
for (const l of landsNorm.lands || []) {
  if (l.externalId) landsByExtId.set(l.externalId, l);
}
console.log(`Lands normalizados cargados: ${landsByExtId.size}`);

// Itera los geometry.json files
const geomFiles = fs
  .readdirSync(LAND_FILES_DIR)
  .filter((f) => f.endsWith("_geometry.json"));
console.log(`Geometry files encontrados: ${geomFiles.length}\n`);

// Calcula área de un polígono WGS84 (lng, lat) en m² usando spherical excess.
// Aproximación: tratar lng/lat como planar con factor de corrección por lat.
function polygonAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  // Proyección equirectangular local: cos(lat promedio)
  const meanLat =
    ring.reduce((s, p) => s + (p[1] || 0), 0) / ring.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosLat;

  // Shoelace formula
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * mPerDegLng;
    const yi = ring[i][1] * mPerDegLat;
    const xj = ring[j][0] * mPerDegLng;
    const yj = ring[j][1] * mPerDegLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area) / 2;
}

function bboxFromRing(ring) {
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const p of ring) {
    if (p[0] < minLng) minLng = p[0];
    if (p[0] > maxLng) maxLng = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  }
  return { minLng, maxLng, minLat, maxLat };
}

const stats = {
  total: 0,
  withPlantZone: 0,
  withObstacleZone: 0,
  withReferencePoint: 0,
  areasHa: [],
  plantZoneVertexCounts: [],
  examples: { smallestRatio: [], largestRatio: [] },
};

const plantZonesByExtId = new Map();

for (const f of geomFiles) {
  const extId = f.replace("_geometry.json", "");
  const geo = JSON.parse(fs.readFileSync(path.join(LAND_FILES_DIR, f), "utf-8"));
  stats.total++;

  if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) continue;

  const plantZone = geo.features.find(
    (ft) => ft?.properties?.funcType === "PlantZone" && ft.geometry
  );
  const obstacleZone = geo.features.find(
    (ft) => ft?.properties?.funcType === "ObstacleZone" && ft.geometry
  );
  const refPoint = geo.features.find(
    (ft) => ft?.properties?.funcType === "ReferencePoint"
  );

  if (plantZone) {
    stats.withPlantZone++;
    if (plantZone.geometry.type === "Polygon") {
      const ring = plantZone.geometry.coordinates[0];
      const areaM2 = polygonAreaM2(ring);
      const areaHa = areaM2 / 10_000;
      stats.areasHa.push(areaHa);
      stats.plantZoneVertexCounts.push(ring.length);
      const bbox = bboxFromRing(ring);
      plantZonesByExtId.set(extId, {
        areaHa,
        bbox,
        vertexCount: ring.length,
      });

      // Cross-check con total_area del lands-normalized
      const land = landsByExtId.get(extId);
      if (land && land.totalAreaMu) {
        const declaredHa = (land.totalAreaMu * 10000) / 15 / 10000;
        const ratio = areaHa / declaredHa;
        if (ratio < 0.5) {
          stats.examples.smallestRatio.push({
            extId,
            areaHa: areaHa.toFixed(4),
            declaredHa: declaredHa.toFixed(4),
            ratio: ratio.toFixed(2),
            vertices: ring.length,
            name: land.name,
          });
        } else if (ratio > 1.5) {
          stats.examples.largestRatio.push({
            extId,
            areaHa: areaHa.toFixed(4),
            declaredHa: declaredHa.toFixed(4),
            ratio: ratio.toFixed(2),
            vertices: ring.length,
            name: land.name,
          });
        }
      }
    } else if (plantZone.geometry.type === "MultiPolygon") {
      // multi-polygon
      const totalArea = plantZone.geometry.coordinates.reduce(
        (s, poly) => s + polygonAreaM2(poly[0]),
        0
      );
      const areaHa = totalArea / 10_000;
      stats.areasHa.push(areaHa);
      const allCoords = plantZone.geometry.coordinates.flat();
      const bbox = bboxFromRing(allCoords);
      plantZonesByExtId.set(extId, {
        areaHa,
        bbox,
        vertexCount: allCoords.length,
        multi: true,
      });
    }
  }
  if (obstacleZone) stats.withObstacleZone++;
  if (refPoint && refPoint.geometry?.coordinates?.length > 0)
    stats.withReferencePoint++;
}

console.log("=== PlantZone ===");
console.log(`  Total geometry files:           ${stats.total}`);
console.log(`  Con PlantZone:                  ${stats.withPlantZone}`);
console.log(`  Con ObstacleZone:               ${stats.withObstacleZone}`);
console.log(`  Con ReferencePoint no vacío:    ${stats.withReferencePoint}`);

const areas = stats.areasHa;
areas.sort((a, b) => a - b);
const sum = areas.reduce((a, b) => a + b, 0);
const mean = sum / areas.length;
const median = areas[Math.floor(areas.length / 2)];
const p25 = areas[Math.floor(areas.length * 0.25)];
const p75 = areas[Math.floor(areas.length * 0.75)];
console.log(`\n=== Distribución áreas PlantZone (ha) ===`);
console.log(`  N:                              ${areas.length}`);
console.log(`  Min:                            ${areas[0].toFixed(4)} ha`);
console.log(`  p25:                            ${p25.toFixed(4)} ha`);
console.log(`  Mediana:                        ${median.toFixed(4)} ha`);
console.log(`  p75:                            ${p75.toFixed(4)} ha`);
console.log(`  Max:                            ${areas[areas.length - 1].toFixed(4)} ha`);
console.log(`  Media:                          ${mean.toFixed(4)} ha`);

const vCounts = stats.plantZoneVertexCounts;
vCounts.sort((a, b) => a - b);
console.log(`\n=== Distribución vértices por polígono ===`);
console.log(`  Min:                            ${vCounts[0]}`);
console.log(`  Mediana:                        ${vCounts[Math.floor(vCounts.length / 2)]}`);
console.log(`  Max:                            ${vCounts[vCounts.length - 1]}`);

console.log(`\n=== Casos extremos (ratio PlantZone / total_area_mu) ===`);
console.log(`Casos con ratio < 0.5 (polígono MUY chico vs declarado):`);
stats.examples.smallestRatio.slice(0, 5).forEach((x) =>
  console.log(
    `  ${x.extId.slice(-12)} "${x.name}": ${x.areaHa} ha vs declarado ${x.declaredHa} ha (ratio ${x.ratio})`
  )
);
console.log(`Casos con ratio > 1.5 (polígono más grande que declarado):`);
stats.examples.largestRatio.slice(0, 5).forEach((x) =>
  console.log(
    `  ${x.extId.slice(-12)} "${x.name}": ${x.areaHa} ha vs declarado ${x.declaredHa} ha (ratio ${x.ratio})`
  )
);

// Persistir para cruce con BD
fs.writeFileSync(
  path.resolve(__dirname, "..", "tmp-plantzones.json"),
  JSON.stringify(
    {
      computedAt: new Date().toISOString(),
      areas: stats.areasHa.sort((a, b) => a - b),
      plantZonesByExtId: Object.fromEntries(plantZonesByExtId),
    },
    null,
    0
  )
);
console.log(`\n[guardado] tmp-plantzones.json`);
