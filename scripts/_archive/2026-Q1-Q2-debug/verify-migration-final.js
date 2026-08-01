// scripts/verify-migration-final.js
// Valida que la migracion dejo docker y supabase en estado equivalente + fixes aplicadas
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
for (const line of envContent.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Client, Pool } = require("pg");
const docker = new Client({ connectionString: "postgresql://postgres:postgres@localhost:5432/afm_flights" });
const sb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await docker.connect();
  const dest = await sb.connect();
  console.log("=== Validacion post-migracion docker vs supabase ===");

  for (const db of [{conn: docker, label: "docker"}, {conn: dest, label: "supabase"}]) {
    const r1 = await db.conn.query("SELECT count(*)::int AS total, count(declared_area_ha)::int AS n_set FROM dji_parcels WHERE deleted_at IS NULL");
    console.log("  " + db.label + ".declared_area_ha:", r1.rows[0]);
  }
  for (const db of [{conn: docker, label: "docker"}, {conn: dest, label: "supabase"}]) {
    const r2 = await db.conn.query("SELECT count(*)::int AS total, count(point)::int AS n_point FROM dji_flights");
    console.log("  " + db.label + ".point:", r2.rows[0]);
  }
  for (const db of [{conn: docker, label: "docker"}, {conn: dest, label: "supabase"}]) {
    const r3 = await db.conn.query(`
      SELECT tgname, tgenabled FROM pg_trigger
      WHERE tgrelid = 'public.dji_flights'::regclass AND NOT tgisinternal
    `);
    console.log("  " + db.label + ".dji_flights triggers:", r3.rows);
  }
  for (const db of [{conn: docker, label: "docker"}, {conn: dest, label: "supabase"}]) {
    const r4 = await db.conn.query(`
      SELECT
        CASE
          WHEN p.spray_geom IS NOT NULL THEN '1_real_spray_geom'
          WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id AND f.point IS NOT NULL) THEN '2_flight_hull'
          WHEN EXISTS (SELECT 1 FROM dji_flights f WHERE f.parcel_id = p.id) THEN '3_flight_buffer'
          ELSE '4_synthetic_ngon'
        END AS layer,
        count(*)::int AS n
      FROM dji_parcels p WHERE p.deleted_at IS NULL
      GROUP BY 1 ORDER BY 1
    `);
    console.log("  " + db.label + ".cascade:", r4.rows);
  }
  for (const db of [{conn: docker, label: "docker"}, {conn: dest, label: "supabase"}]) {
    const r5 = await db.conn.query(`
      SELECT
        CASE
          WHEN p.spray_geom IS NULL THEN 'null'
          WHEN ST_GeometryType(p.spray_geom) = 'ST_MultiPolygon' THEN 'MultiPolygon'
          ELSE 'Polygon'
        END AS type,
        count(*)::int AS n
      FROM dji_parcels p WHERE p.deleted_at IS NULL
      GROUP BY 1 ORDER BY 1
    `);
    console.log("  " + db.label + ".spray_geom types:", r5.rows);
  }
  await docker.end();
  dest.release();
  await sb.end();
})();
