#!/usr/bin/env node
// scripts/diag-polygons-offline.js
//
// Quick smoke test: ¿está viva la BD? ¿hay data en dji_parcels?
// Conecta al docker local (puerto 5432, user/pass = postgres/postgres).

const { Client } = require("pg");

async function main() {
  const c = new Client({
    connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights",
  });
  await c.connect();

  const r = await c.query(`
    SELECT
      (SELECT count(*)::int FROM dji_parcels) AS total,
      (SELECT count(*)::int FROM dji_parcels WHERE spray_geom IS NOT NULL) AS with_spray_geom,
      (SELECT count(*)::int FROM dji_parcels WHERE bbox IS NOT NULL) AS with_bbox,
      (SELECT count(*)::int FROM dji_parcels WHERE position IS NOT NULL) AS with_position,
      (SELECT count(*)::int FROM dji_parcels WHERE field_type = 'Farmland') AS farmlands,
      (SELECT count(*)::int FROM dji_parcels WHERE field_type = 'Farmland' AND spray_geom IS NOT NULL) AS farmlands_with_geom,
      (SELECT count(*)::int FROM dji_parcels WHERE field_type = 'Farmland' AND bbox IS NOT NULL) AS farmlands_with_bbox,
      (SELECT count(*)::int FROM dji_parcels WHERE field_type = 'Farmland' AND total_area_mu IS NOT NULL) AS farmlands_with_area
  `);
  console.log("=== Conteos base (docker local) ===");
  console.log(JSON.stringify(r.rows[0], null, 2));

  await c.end();
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
