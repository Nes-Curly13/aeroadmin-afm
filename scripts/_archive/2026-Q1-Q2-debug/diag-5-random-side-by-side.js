#!/usr/bin/env node
// scripts/diag-5-random-side-by-side.js
//
// Para 5 parcelas random, muestra side-by-side:
//   - Lo que está en dji_parcels (BD)
//   - Lo que dice lands-normalized.json (DJI source)
// Highlight de los NULL en BD.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const LANDS_NORMALIZED = path.resolve(__dirname, "..", "djiag_exports", "lands-normalized.json");

const landsNorm = JSON.parse(fs.readFileSync(LANDS_NORMALIZED, "utf-8"));
const landsByExtId = new Map();
for (const l of landsNorm.lands || []) {
  if (l.externalId) landsByExtId.set(l.externalId, l);
}

const c = new Client({
  connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
});

(async () => {
  await c.connect();

  // 5 random
  const samples = await c.query(`
    SELECT id, external_id, land_name, field_type, is_orchard,
           position::text AS pos_text,
           ST_AsText(bbox) AS bbox_text,
           ST_AsGeoJSON(spray_geom)::json AS spray_geom_geojson,
           tags, serial_number, dji_land_uuid,
           total_area_mu, work_area_mu, obstacle_area_mu,
           land_type_raw, location_label, api_fetched_at,
           source_url_geometry, source_url_parameter, source_url_waypoint
    FROM dji_parcels
    WHERE spray_geom IS NOT NULL
    ORDER BY random()
    LIMIT 5
  `);

  for (const row of samples.rows) {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`# PARCEL id=${row.id} | ext=${row.external_id}`);
    console.log(`${"=".repeat(80)}`);

    const dji = landsByExtId.get(row.external_id);
    if (!dji) {
      console.log(`  [NO EN LANDS-NORMALIZED.JSON]`);
      continue;
    }

    const diff = (label, bdVal, djiVal) => {
      const bdStr = bdVal === null || bdVal === undefined ? "NULL" : String(bdVal);
      const djiStr = djiVal === null || djiVal === undefined ? "null" : String(djiVal);
      const same = bdStr === djiStr;
      const sym = same ? "  " : "≠ ";
      console.log(`  ${sym}${label.padEnd(20)} BD=${bdStr.padEnd(40)} DJI=${djiStr}`);
      return same;
    };

    console.log(`\n  [METADATA]`);
    diff("land_name",        row.land_name,        dji.name);
    diff("land_type_raw",    row.land_type_raw,    dji.landType);
    diff("is_orchard",       row.is_orchard,       dji.landType === "Orchards");
    diff("serial_number",    row.serial_number,    dji.serialNumber);
    diff("dji_land_uuid",    row.dji_land_uuid,    dji.uuid);
    diff("location_label",   row.location_label,   dji.address);
    diff("total_area_mu",    row.total_area_mu,    dji.totalAreaMu);
    diff("work_area_mu",     row.work_area_mu,     dji.workAreaMu);
    diff("obstacle_area_mu", row.obstacle_area_mu, dji.obstacleAreaMu);
    diff("tags",             row.tags,             JSON.stringify(dji.tags));
    diff("source_url_geom",  row.source_url_geometry, dji.geometryUrl);
    diff("api_fetched_at",   row.api_fetched_at,   "(should be set)");

    console.log(`\n  [POSITION]`);
    if (dji.position) {
      const expected = `POINT(${dji.position.lng} ${dji.position.lat})`;
      diff("position WKT", row.pos_text, expected);
    } else {
      console.log(`  DJI position: null`);
    }

    console.log(`\n  [BBOX]`);
    if (dji.bbox && dji.bbox.upperRight && dji.bbox.downLeft) {
      const dllng = dji.bbox.downLeft.lng;
      const dllat = dji.bbox.downLeft.lat;
      const urlng = dji.bbox.upperRight.lng;
      const urlat = dji.bbox.upperRight.lat;
      const expected = `POLYGON((${dllng} ${dllat}, ${urlng} ${dllat}, ${urlng} ${urlat}, ${dllng} ${urlat}, ${dllng} ${dllat}))`;
      diff("bbox WKT", row.bbox_text, expected);
    }

    console.log(`\n  [POLYGON — solo stats]`);
    const a = await c.query(
      `SELECT round((ST_Area(spray_geom::geography))::numeric, 2) AS m2,
              ST_NPoints(spray_geom) AS n_points,
              ST_AsText(ST_Centroid(spray_geom)) AS centroid_wkt
       FROM dji_parcels WHERE id = $1`,
      [row.id]
    );
    const p = a.rows[0];
    console.log(`  spray_geom area:    ${p.m2} m²  (${(p.m2 / 10000).toFixed(4)} ha)`);
    console.log(`  spray_geom n_points: ${p.n_points}`);
    console.log(`  spray_geom centroid: ${p.centroid_wkt}`);
  }

  await c.end();
})();
