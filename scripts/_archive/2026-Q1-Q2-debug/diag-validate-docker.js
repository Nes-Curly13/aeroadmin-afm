// scripts/diag-validate-docker.js
// Ejecuta la query de api/queries.ts contra docker y verifica que devuelve
// Polygon (no MultiPolygon) y que los 1213 parcels tienen la cascada correcta.
const { Client } = require("pg");
const c = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
(async () => {
  await c.connect();

  // 1) Query equivalente a la de api/queries.ts (con ST_GeometryN)
  console.log("=== Query equivalente a api/queries.ts: spray_geometry ===");
  const r = await c.query(`
    SELECT
      p.id,
      ST_GeometryType(p.spray_geom) AS raw_type,
      CASE
        WHEN p.spray_geom IS NULL THEN NULL
        WHEN ST_GeometryType(p.spray_geom) = 'ST_MultiPolygon'
          THEN ST_GeometryType(ST_GeometryN(p.spray_geom, 1))
        ELSE ST_GeometryType(p.spray_geom)
      END AS adapter_type,
      ST_AsGeoJSON(
        CASE
          WHEN p.spray_geom IS NULL THEN NULL
          WHEN ST_GeometryType(p.spray_geom) = 'ST_MultiPolygon'
            THEN ST_GeometryN(p.spray_geom, 1)
          ELSE p.spray_geom
        END
      )::json->>'type' AS adapter_jsontype,
      p.declared_area_ha
    FROM dji_parcels p
    WHERE p.deleted_at IS NULL
    ORDER BY p.id
  `);
  console.log("Total rows:", r.rows.length);
  // Distribucion de adapter_type
  const dist = {};
  r.rows.forEach(x => { dist[x.adapter_type] = (dist[x.adapter_type] || 0) + 1; });
  console.log("Distribucion de adapter_type:", dist);
  // Distribucion de adapter_jsontype
  const distJson = {};
  r.rows.forEach(x => { distJson[x.adapter_jsontype] = (distJson[x.adapter_jsontype] || 0) + 1; });
  console.log("Distribucion de adapter_jsontype (JSON):", distJson);

  // 2) ¿declared_area_ha todos != NULL?
  const r2 = await c.query(`
    SELECT count(*)::int AS total,
           count(declared_area_ha)::int AS n_set,
           min(declared_area_ha)::numeric AS min_a,
           max(declared_area_ha)::numeric AS max_a,
           avg(declared_area_ha)::numeric AS avg_a
    FROM dji_parcels WHERE deleted_at IS NULL
  `);
  console.log("\ndeclared_area_ha stats:", r2.rows[0]);

  // 3) Hulls de flights fumigados (lo que ahora debería funcionar con point lleno)
  const r3 = await c.query(`
    WITH hulls AS (
      SELECT
        f.parcel_id,
        count(*)::int AS nflights,
        ST_ConvexHull(ST_Collect(f.point)) AS hull
      FROM dji_flights f
      WHERE f.parcel_id IS NOT NULL AND f.point IS NOT NULL
      GROUP BY f.parcel_id
    )
    SELECT
      ST_GeometryType(hull) AS hulltype,
      count(*)::int AS n_parcels
    FROM hulls
    GROUP BY ST_GeometryType(hull)
    ORDER BY n_parcels DESC
  `);
  console.log("\nConvexHull por parcel (con point lleno):");
  r3.rows.forEach(x => console.log("  " + x.hulltype + ": " + x.n_parcels));

  // 4) Distribucion de cascada que el adapter haría
  const r4 = await c.query(`
    SELECT
      CASE
        WHEN p.spray_geom IS NOT NULL THEN '1_real_spray_geom'
        WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id AND f.point IS NOT NULL) THEN '2_flight_hull'
        WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id) THEN '3_flight_buffer'
        ELSE '4_synthetic_ngon'
      END AS cascade_layer,
      count(*)::int AS n
    FROM dji_parcels p
    WHERE p.deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("\nCascada del adapter (docker con fixes):");
  r4.rows.forEach(x => console.log("  " + x.cascade_layer + ": " + x.n));

  // 5) Misma cascada en supabase para comparar
  const sb = new (require("pg").Pool)({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const sbC = await sb.connect();
  const r5 = await sbC.query(`
    SELECT
      CASE
        WHEN p.spray_geom IS NOT NULL THEN '1_real_spray_geom'
        WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id AND f.point IS NOT NULL) THEN '2_flight_hull'
        WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id) THEN '3_flight_buffer'
        ELSE '4_synthetic_ngon'
      END AS cascade_layer,
      count(*)::int AS n
    FROM dji_parcels p
    WHERE p.deleted_at IS NULL
    GROUP BY 1
    ORDER BY 1
  `);
  console.log("\nCascada del adapter (supabase actual, sin fix):");
  r5.rows.forEach(x => console.log("  " + x.cascade_layer + ": " + x.n));

  await c.end();
  sbC.release();
  await sb.end();
})();
