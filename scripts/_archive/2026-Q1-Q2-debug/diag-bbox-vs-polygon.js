#!/usr/bin/env node
// scripts/diag-bbox-vs-polygon.js
//
// Compara el bbox que devuelve DJI en `?name=lands` con el bounding box
// calculado del PlantZone. Si son muy distintos, el PlantZone es un subset
// del campo. Si coinciden, el PlantZone ES el campo.

const fs = require("fs");
const path = require("path");

const LAND_FILES_DIR = path.resolve(__dirname, "..", "djiag_exports", "land_files");
const LANDS_NORMALIZED = path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json");

const landsNorm = JSON.parse(fs.readFileSync(LANDS_NORMALIZED, "utf-8"));
const landsByExtId = new Map();
for (const l of landsNorm.lands || []) {
  if (l.externalId) landsByExtId.set(l.externalId, l);
}

function flattenPolygon(coords) {
  return coords[0].map(([lng, lat]) => [+lng, +lat]);
}

function polygonBbox(ring) {
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

function bboxAreaHa(b) {
  const meanLat = (b.minLat + b.maxLat) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const dLng = (b.maxLng - b.minLng) * 111320 * cosLat;
  const dLat = (b.maxLat - b.minLat) * 111320;
  return (dLng * dLat) / 10000;
}

const geomFiles = fs
  .readdirSync(LAND_FILES_DIR)
  .filter((f) => f.endsWith("_geometry.json"));

let nChecked = 0;
let nWithBboxInDJI = 0;
let nBboxLargerThanPolygon = 0; // bbox de DJI > bbox del PlantZone → PlantZone es subset
let nBboxMatchesPolygon = 0; // bbox de DJI ≈ bbox del PlantZone → PlantZone ES el campo
const ratios = []; // bbox_dji_area / bbox_polygon_area
const examplesSubset = []; // casos donde el bbox es claramente mayor
const examplesMatch = []; // casos donde coinciden

for (const f of geomFiles) {
  const extId = f.replace("_geometry.json", "");
  const land = landsByExtId.get(extId);
  if (!land || !land.bbox) continue;

  const geo = JSON.parse(fs.readFileSync(path.join(LAND_FILES_DIR, f), "utf-8"));
  const plantZone = geo.features.find(
    (ft) => ft?.properties?.funcType === "PlantZone" && ft.geometry
  );
  if (!plantZone || plantZone.geometry.type !== "Polygon") continue;

  nChecked++;
  const polygonRing = flattenPolygon(plantZone.geometry.coordinates);
  const polygonBboxObj = polygonBbox(polygonRing);
  const polygonBboxHa = bboxAreaHa(polygonBboxObj);

  // bbox de DJI: upperRight (latNE, lngNE) + downLeft (latSW, lngSW)
  const djiBbox = {
    minLng: land.bbox.downLeft.lng,
    minLat: land.bbox.downLeft.lat,
    maxLng: land.bbox.upperRight.lng,
    maxLat: land.bbox.upperRight.lat,
  };
  const djiBboxHa = bboxAreaHa(djiBbox);

  const ratio = djiBboxHa / polygonBboxHa;
  ratios.push(ratio);

  if (ratio > 1.05) {
    nBboxLargerThanPolygon++;
    if (examplesSubset.length < 5) {
      examplesSubset.push({
        extId,
        name: land.name,
        djiBboxHa: djiBboxHa.toFixed(4),
        polygonBboxHa: polygonBboxHa.toFixed(4),
        ratio: ratio.toFixed(2),
        totalAreaMu: land.totalAreaMu,
      });
    }
  } else {
    nBboxMatchesPolygon++;
    if (examplesMatch.length < 3) {
      examplesMatch.push({
        extId,
        name: land.name,
        djiBboxHa: djiBboxHa.toFixed(4),
        polygonBboxHa: polygonBboxHa.toFixed(4),
        ratio: ratio.toFixed(2),
      });
    }
  }
  nWithBboxInDJI++;
}

ratios.sort((a, b) => a - b);
const p50 = ratios[Math.floor(ratios.length / 2)];
const p25 = ratios[Math.floor(ratios.length * 0.25)];
const p75 = ratios[Math.floor(ratios.length * 0.75)];

console.log(`Total geometrías con bbox DJI: ${nWithBboxInDJI}`);
console.log(`Casos con bbox DJI > bbox polígono ×1.05 (subset): ${nBboxLargerThanPolygon}`);
console.log(`Casos con bbox DJI ≈ bbox polígono (match):          ${nBboxMatchesPolygon}`);
console.log(`\nDistribución del ratio (bbox_dji / bbox_polygon):`);
console.log(`  Min:  ${ratios[0]?.toFixed(3)}`);
console.log(`  p25:  ${p25?.toFixed(3)}`);
console.log(`  p50:  ${p50?.toFixed(3)}`);
console.log(`  p75:  ${p75?.toFixed(3)}`);
console.log(`  Max:  ${ratios[ratios.length - 1]?.toFixed(3)}`);

console.log(`\nEjemplos de SUBSET (bbox > polígono):`);
examplesSubset.forEach((x) =>
  console.log(
    `  ${x.extId.slice(-12)} "${x.name}": bbox_dji=${x.djiBboxHa} ha, bbox_pol=${x.polygonBboxHa} ha (ratio ${x.ratio})`
  )
);
console.log(`\nEjemplos de MATCH (bbox ≈ polígono):`);
examplesMatch.forEach((x) =>
  console.log(
    `  ${x.extId.slice(-12)} "${x.name}": bbox_dji=${x.djiBboxHa} ha, bbox_pol=${x.polygonBboxHa} ha (ratio ${x.ratio})`
  )
);
