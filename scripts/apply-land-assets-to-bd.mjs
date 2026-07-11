#!/usr/bin/env node
// scripts/apply-land-assets-to-bd.mjs
//
// (Sprint 3 / 2026-07-11) Aplica los assets descargados
// (`djiag_exports/land_files/*.json`) a `dji_parcels` SIN BORRAR NADA.
//
// El importador original `import_djiag_data.js` hace `DELETE FROM
// dji_parcels` antes de re-insertar, lo que destruye los datos del
// re-scrape del 2026-07-09 (total_area_mu, work_area_mu, obstacle_area_mu,
// location_label, declared_area_ha, etc.). Este script solo hace
// UPDATE de las 7 columnas que vienen de los assets JSON, preservando
// todo lo demás.
//
// Por cada externalId, lee hasta 3 archivos:
//   - {extId}_geometry.json   → spray_geom + raw_geometry
//   - {extId}_parameter.json  → raw_parameter + reference_point (de seg_edge_home_point)
//   - {extId}_waypoint.json   → waypoints + waypoint_count + raw_waypoint
//
// Uso:
//   node scripts/apply-land-assets-to-bd.mjs                  # aplica todo
//   node scripts/apply-land-assets-to-bd.mjs --max-lands 50  # test
//   node scripts/apply-land-assets-to-bd.mjs --dry-run        # ver qué haría
//
// Idempotente: corre N veces = mismo resultado.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : fallback;
};

const FILES_DIR = resolve(arg("files-dir", "djiag_exports/land_files"));
const DRY_RUN = args.includes("--dry-run");
const MAX_LANDS = Number(arg("max-lands", 0)) || null;
const BATCH_SIZE = 100;

// Cargar DATABASE_URL
function loadEnv() {
  try {
    const txt = readFileSync(".env.local", "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}
loadEnv();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL no está en .env.local");

const client = new pg.Client({ connectionString: DB_URL });

// ============================================================
// Parsers (idénticos a import_djiag_data.js — copiados para no
// importar el .js que es destructivo)
// ============================================================

/** Convierte un FeatureCollection de DJI a un SQL PostGIS MultiPolygon
 *  usando solo el feature con funcType="PlantZone". */
function geometryToSql(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection") return null;
  const plant = geojson.features.find(
    (f) => f?.properties?.funcType === "PlantZone" && f.geometry
  );
  if (!plant) return null;
  // DJI polygons a veces self-intersectan; ST_Buffer(geom, 0) repara.
  return `ST_Multi(ST_Buffer(ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(plant.geometry).replaceAll("'", "''")}')), 0))`;
}

/** Convierte seg_edge_home_point (string JSON con {lat, lng, ...}) a SQL
 *  PostGIS Point. Soporta también GeoJSON Point y FeatureCollection. */
function homePointToSql(value) {
  if (value === null || value === undefined || value === "") return null;
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  if (parsed.type === "Point" && Array.isArray(parsed.coordinates)) {
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(parsed).replaceAll("'", "''")}'))`;
  }
  if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
    const feat = parsed.features.find((f) => f.geometry?.type === "Point");
    if (feat) {
      return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(feat.geometry).replaceAll("'", "''")}'))`;
    }
  }
  if (parsed.type === "Feature" && parsed.geometry?.type === "Point") {
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(parsed.geometry).replaceAll("'", "''")}'))`;
  }
  // Caso DJI flat {lat, lng}
  if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
    const point = { type: "Point", coordinates: [parsed.lng, parsed.lat, 0] };
    return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(point).replaceAll("'", "''")}'))`;
  }
  return null;
}

/** Convierte un FeatureCollection de Points a un SQL PostGIS MultiPoint. */
function waypointsToSql(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection") return null;
  const points = geojson.features
    .map((f) => f.geometry)
    .filter((g) => g && g.type === "Point" && Array.isArray(g.coordinates));
  if (points.length === 0) return null;
  const mp = { type: "MultiPoint", coordinates: points.map((p) => p.coordinates) };
  return `ST_Force2D(ST_GeomFromGeoJSON('${JSON.stringify(mp).replaceAll("'", "''")}'))`;
}

// ============================================================
// Builder de UPDATE SQL (preserva todas las otras columnas)
// ============================================================
function buildUpdateSql({ externalId, sprayGeomSql, refPointSql, waypointsSql, waypointCount,
                          rawGeometry, rawParameter, rawWaypoint }) {
  const setClauses = [];
  // Para evitar problemas de prepared statements con pg (que cachea
  // statements por texto y rompe cuando el # de params cambia entre
  // iteraciones), concatenamos los valores seguros directamente al SQL.
  //   - externalId: validado por filename regex (alfanum + dash)
  //   - waypointCount: integer
  //   - rawGeometry/rawParameter/rawWaypoint: JSON.stringify escapado
  //   - sprayGeomSql/refPointSql/waypointsSql: SQL PostGIS generado por
  //     nuestras propias funciones (no viene del usuario)
  if (sprayGeomSql) setClauses.push(`spray_geom = ${sprayGeomSql}`);
  if (refPointSql) setClauses.push(`reference_point = ${refPointSql}`);
  if (waypointsSql) {
    setClauses.push(`waypoints = ${waypointsSql}`);
    if (Number.isInteger(waypointCount)) {
      setClauses.push(`waypoint_count = ${waypointCount}`);
    }
  } else if (Number.isInteger(waypointCount)) {
    setClauses.push(`waypoint_count = ${waypointCount}`);
  }
  if (rawGeometry) setClauses.push(`raw_geometry = '${escJsonb(rawGeometry)}'::jsonb`);
  if (rawParameter) setClauses.push(`raw_parameter = '${escJsonb(rawParameter)}'::jsonb`);
  if (rawWaypoint) setClauses.push(`raw_waypoint = '${escJsonb(rawWaypoint)}'::jsonb`);

  if (setClauses.length === 0) return null;

  // externalId siempre safe: viene del filename que matchea /^[0-9-]+-flyer-[0-9a-f-]+$/
  // pero lo escapamos igual por las dudas.
  return `
    UPDATE dji_parcels
    SET ${setClauses.join(",\n        ")}
    WHERE external_id = '${escSql(externalId)}'
  `;
}

function escSql(s) {
  return String(s).replaceAll("'", "''");
}

function escJsonb(s) {
  // JSON.stringify ya produce JSON válido con \" escapado internamente.
  // Solo escapamos las comillas simples (delimitador SQL).
  return String(s).replaceAll("'", "''");
}

// ============================================================
// Loop principal
// ============================================================
async function main() {
  await client.connect();
  console.log(`[apply-land-assets] connected. files_dir=${FILES_DIR}`);

  // Agrupar archivos por externalId
  const filesByExtId = new Map();
  for (const name of readdirSync(FILES_DIR)) {
    if (!name.endsWith(".json")) continue;
    const m = name.match(/^(.+?)_(geometry|parameter|waypoint)\.json$/);
    if (!m) continue;
    const [, extId, kind] = m;
    if (!filesByExtId.has(extId)) filesByExtId.set(extId, {});
    filesByExtId.get(extId)[kind] = join(FILES_DIR, name);
  }

  const extIds = Array.from(filesByExtId.keys());
  const subset = MAX_LANDS ? extIds.slice(0, MAX_LANDS) : extIds;
  console.log(`[apply-land-assets] ${subset.length}/${extIds.length} externalIds con assets`);
  console.log(`[apply-land-assets] mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let geomHits = 0;
  let paramHits = 0;
  let waypointHits = 0;
  let refPointHits = 0;

  let i = 0;
  for (const extId of subset) {
    i++;
    const files = filesByExtId.get(extId);
    let sprayGeomSql = null;
    let refPointSql = null;
    let waypointsSql = null;
    let waypointCount = null;
    let rawGeometry = null;
    let rawParameter = null;
    let rawWaypoint = null;

    // geometry
    if (files.geometry) {
      try {
        const json = JSON.parse(readFileSync(files.geometry, "utf8"));
        sprayGeomSql = geometryToSql(json);
        rawGeometry = JSON.stringify(json);
        if (sprayGeomSql) geomHits++;
      } catch (e) { /* skip */ }
    }
    // parameter (raw + reference_point de seg_edge_home_point)
    if (files.parameter) {
      try {
        const json = JSON.parse(readFileSync(files.parameter, "utf8"));
        rawParameter = JSON.stringify(json);
        if (json.seg_edge_home_point) {
          refPointSql = homePointToSql(json.seg_edge_home_point);
          if (refPointSql) refPointHits++;
        }
        paramHits++;
      } catch (e) { /* skip */ }
    }
    // waypoint
    if (files.waypoint) {
      try {
        const json = JSON.parse(readFileSync(files.waypoint, "utf8"));
        waypointsSql = waypointsToSql(json);
        waypointCount = (json.features || []).length;
        rawWaypoint = JSON.stringify(json);
        if (waypointsSql) waypointHits++;
      } catch (e) { /* skip */ }
    }

    const sql = buildUpdateSql({
      externalId: extId,
      sprayGeomSql, refPointSql, waypointsSql, waypointCount,
      rawGeometry, rawParameter, rawWaypoint
    });

    if (!sql) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] ${extId}: would update ${[
        sprayGeomSql && "geom",
        refPointSql && "ref_point",
        waypointsSql && "waypoints",
        rawGeometry && "raw_geom",
        rawParameter && "raw_param",
        rawWaypoint && "raw_wp"
      ].filter(Boolean).join(", ")}`);
      updated++;
      continue;
    }

    try {
      const result = await client.query(sql);
      if (result.rowCount > 0) updated++;
      else skipped++; // externalId no estaba en dji_parcels
    } catch (e) {
      errors++;
      console.error(`  [error] ${extId}: ${e.message.slice(0, 120)}`);
    }

    if (i % 200 === 0) {
      console.log(`[apply-land-assets] progress: ${i}/${subset.length} (updated=${updated} skipped=${skipped} errors=${errors})`);
    }
  }

  console.log("");
  console.log(`[apply-land-assets] DONE`);
  console.log(`  externalIds:     ${subset.length}`);
  console.log(`  updated:         ${updated}`);
  console.log(`  skipped:         ${skipped}`);
  console.log(`  errors:          ${errors}`);
  console.log(`  with spray_geom:    ${geomHits}`);
  console.log(`  with reference_point: ${refPointHits}`);
  console.log(`  with waypoints:      ${waypointHits}`);
  console.log(`  with raw_parameter:  ${paramHits}`);

  await client.end();
}

main().catch((e) => {
  console.error("[apply-land-assets] FATAL:", e.stack || e.message);
  process.exit(1);
});
