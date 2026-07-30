#!/usr/bin/env node
// scripts/diagnose-parcel-geometry.js
//
// Diagnostico para el sprint de poligonos. Cuenta cuantas parcelas tienen
// geometria utilizable en cada fuente posible, y propone el approach
// optimo para `lib/data.ts` (ver ADOPTION.md del Gauntlet).
//
// Fuentes de geometria (en orden de fidelidad esperada):
//   1. dji_parcels.waypoints         (MultiPoint) -- plan de vuelo del dron
//   2. dji_flights.lng, .lat         (Point por vuelo) -- fumigaciones reales
//   3. dji_parcels.reference_point   (Point) -- punto de referencia del lote
//   4. synthetic (cuadrado)          -- fallback actual
//
// Uso:
//   node scripts/diagnose-parcel-geometry.js
//   node scripts/diagnose-parcel-geometry.js --json  (output como JSON)
//
// Requiere: DATABASE_URL en .env.local (Supabase pooled URL, puerto 6543).

const { Client } = require("pg");
const path = require("path");

// Carga .env.local sin necesidad de dotenv (es lo que Next.js hace igual)
const fs = require("fs");
const envPath = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const asJson = process.argv.includes("--json");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL no esta en .env.local");
    process.exit(1);
  }
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  // ------------------------------------------------------------------------
  // 1. Conteos base
  // ------------------------------------------------------------------------
  const totals = await c.query(`
    SELECT
      (SELECT count(*)::int FROM dji_parcels) AS total_parcels,
      (SELECT count(*)::int FROM dji_parcels WHERE spray_geom IS NOT NULL) AS with_spray_geom,
      (SELECT count(*)::int FROM dji_parcels WHERE waypoints IS NOT NULL AND waypoint_count > 0) AS with_waypoints,
      (SELECT count(*)::int FROM dji_parcels WHERE reference_point IS NOT NULL) AS with_reference_point,
      (SELECT count(*)::int FROM dji_flights) AS total_flights,
      (SELECT count(*)::int FROM dji_flights WHERE parcel_id IS NOT NULL AND lng IS NOT NULL) AS flights_with_parcel
  `);
  const t = totals.rows[0];

  // ------------------------------------------------------------------------
  // 2. Distribucion de flights por parcel
  // ------------------------------------------------------------------------
  const flightDist = await c.query(`
    SELECT
      count(*)::int AS parcels_with_flights,
      coalesce(sum(c), 0)::int AS total_flight_records,
      coalesce(avg(c), 0)::float AS avg_flights_per_parcel,
      count(*) FILTER (WHERE c >= 3)::int AS parcels_3plus,
      count(*) FILTER (WHERE c >= 5)::int AS parcels_5plus,
      count(*) FILTER (WHERE c = 1)::int AS parcels_1,
      count(*) FILTER (WHERE c = 2)::int AS parcels_2
    FROM (
      SELECT parcel_id, count(*)::int AS c
      FROM dji_flights
      WHERE parcel_id IS NOT NULL AND lng IS NOT NULL
      GROUP BY parcel_id
    ) t
  `);
  const f = flightDist.rows[0];

  // ------------------------------------------------------------------------
  // 3. Waypoint count distribution
  // ------------------------------------------------------------------------
  const wpDist = await c.query(`
    SELECT
      count(*)::int AS parcels_with_waypoints,
      coalesce(avg(waypoint_count), 0)::float AS avg_waypoints,
      coalesce(min(waypoint_count), 0)::int AS min_waypoints,
      coalesce(max(waypoint_count), 0)::int AS max_waypoints,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY waypoint_count), 0)::float AS median_waypoints
    FROM dji_parcels
    WHERE waypoints IS NOT NULL AND waypoint_count > 0
  `);
  const w = wpDist.rows[0];

  // ------------------------------------------------------------------------
  // 4. Cruce: cuantos parcels tienen AL MENOS una fuente
  // ------------------------------------------------------------------------
  const coverage = await c.query(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE has_waypoints OR has_flights_3plus)::int AS covered_by_real_geom,
      count(*) FILTER (WHERE has_waypoints)::int AS covered_by_waypoints,
      count(*) FILTER (WHERE NOT has_waypoints AND has_flights_3plus)::int AS covered_by_flights,
      count(*) FILTER (WHERE NOT has_waypoints AND NOT has_flights_3plus AND has_reference_point)::int AS covered_by_refpoint_only,
      count(*) FILTER (WHERE NOT has_waypoints AND NOT has_flights_3plus AND NOT has_reference_point)::int AS needs_synthetic
    FROM (
      SELECT
        p.id,
        (p.waypoints IS NOT NULL AND p.waypoint_count > 0) AS has_waypoints,
        (p.reference_point IS NOT NULL) AS has_reference_point,
        (SELECT count(*) FROM dji_flights f WHERE f.parcel_id = p.id AND f.lng IS NOT NULL) >= 3 AS has_flights_3plus
      FROM dji_parcels p
    ) t
  `);
  const cov = coverage.rows[0];

  // ------------------------------------------------------------------------
  // 5. Muestra de 3 parcels con waypoints (para inspeccionar la forma)
  // ------------------------------------------------------------------------
  const sample = await c.query(`
    SELECT
      p.id AS parcel_id,
      p.land_name,
      p.waypoint_count,
      ST_AsGeoJSON(p.waypoints)::json AS waypoints_geojson,
      (SELECT count(*)::int FROM dji_flights f WHERE f.parcel_id = p.id AND f.lng IS NOT NULL) AS flight_count,
      p.declared_area_ha
    FROM dji_parcels p
    WHERE p.waypoints IS NOT NULL AND p.waypoint_count > 0
    ORDER BY p.waypoint_count DESC
    LIMIT 3
  `);

  // ------------------------------------------------------------------------
  // Output
  // ------------------------------------------------------------------------
  const result = {
    totals: t,
    flights: f,
    waypoints: w,
    coverage: cov,
    sample: sample.rows.map(r => ({
      parcel_id: r.parcel_id,
      land_name: r.land_name,
      waypoint_count: r.waypoint_count,
      flight_count: r.flight_count,
      declared_area_ha: r.declared_area_ha,
      waypoint_coords: r.waypoints_geojson?.coordinates?.[0]?.slice(0, 4) ?? null  // primeros 4
    })),
    recommendation: null
  };

  // Logica de recomendacion
  if (t.with_spray_geom > 0) {
    result.recommendation = "USE spray_geom (ya hay geometria real en algunos parcels)";
  } else if (cov.covered_by_waypoints / cov.total > 0.5) {
    result.recommendation = "WAYPOINTS como fuente primaria (cubre >50% de parcels)";
  } else if (cov.covered_by_flights / cov.total > 0.5) {
    result.recommendation = "FLIGHTS como fuente primaria (waypoints poco poblado, flights cubren >50%)";
  } else {
    result.recommendation = "HYBRID por capas + mejorar synthetic como fallback (ninguna fuente cubre >50%)";
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("\n=== DIAGNOSTICO DE GEOMETRIA DE PARCELS ===\n");
    console.log("Totales:");
    console.log(`  Parcels totales:                    ${t.total_parcels}`);
    console.log(`  Con spray_geom (real):              ${t.with_spray_geom} (${pct(t.with_spray_geom, t.total_parcels)})`);
    console.log(`  Con waypoints populados:            ${t.with_waypoints} (${pct(t.with_waypoints, t.total_parcels)})`);
    console.log(`  Con reference_point:                ${t.with_reference_point} (${pct(t.with_reference_point, t.total_parcels)})`);
    console.log(`  Flights totales:                    ${t.total_flights}`);
    console.log(`  Flights con parcel_id:              ${t.flights_with_parcel}`);
    console.log("");
    console.log("Distribucion de flights por parcel:");
    console.log(`  Parcels con al menos 1 flight:      ${f.parcels_with_flights} (${pct(f.parcels_with_flights, t.total_parcels)})`);
    console.log(`  Promedio flights/parcel:            ${f.avg_flights_per_parcel.toFixed(1)}`);
    console.log(`  Con 1 flight:                       ${f.parcels_1}`);
    console.log(`  Con 2 flights:                      ${f.parcels_2}`);
    console.log(`  Con 3+ flights (util para hull):    ${f.parcels_3plus} (${pct(f.parcels_3plus, t.total_parcels)})`);
    console.log(`  Con 5+ flights (hull robusto):      ${f.parcels_5plus} (${pct(f.parcels_5plus, t.total_parcels)})`);
    console.log("");
    console.log("Waypoints:");
    if (w.parcels_with_waypoints > 0) {
      console.log(`  Parcels con waypoints:              ${w.parcels_with_waypoints} (${pct(w.parcels_with_waypoints, t.total_parcels)})`);
      console.log(`  Promedio waypoints/parcel:          ${w.avg_waypoints.toFixed(1)}`);
      console.log(`  Min / Max:                          ${w.min_waypoints} / ${w.max_waypoints}`);
      console.log(`  Mediana:                            ${w.median_waypoints}`);
    } else {
      console.log(`  (sin waypoints populados)`);
    }
    console.log("");
    console.log("Cobertura esperada con hybrid por capas:");
    console.log(`  Waypoints (forma real):             ${cov.covered_by_waypoints} (${pct(cov.covered_by_waypoints, cov.total)})`);
    console.log(`  Flights 3+ (hull fumigado):         ${cov.covered_by_flights} (${pct(cov.covered_by_flights, cov.total)})`);
    console.log(`  Solo reference_point (buffer):      ${cov.covered_by_refpoint_only} (${pct(cov.covered_by_refpoint_only, cov.total)})`);
    console.log(`  Necesita synthetic (cuadrado):      ${cov.needs_synthetic} (${pct(cov.needs_synthetic, cov.total)})`);
    console.log("");
    console.log("Muestra de parcels con waypoints (primeros 4 coords de cada uno):");
    result.sample.forEach(s => {
      console.log(`  Parcel #${s.parcel_id} (${s.land_name}): ${s.waypoint_count} waypoints, ${s.flight_count} flights, area ${s.declared_area_ha} ha`);
      if (s.waypoint_coords) {
        s.waypoint_coords.forEach(c => console.log(`    [${c[0].toFixed(5)}, ${c[1].toFixed(5)}]`));
      }
    });
    console.log("");
    console.log(`>>> RECOMENDACION: ${result.recommendation}`);
    console.log("");
  }

  await c.end();
}

function pct(a, b) {
  if (b === 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
}

main().catch(e => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
