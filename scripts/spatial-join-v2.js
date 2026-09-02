// Spatial join v2: 1 sola query con KNN (sin LATERAL), tolerance 200m, sin batches.
const fs = require("fs"), path = require("path");
const envPath = path.resolve(".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const { Client } = require("pg");
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log("Starting at", new Date().toISOString());
  const t0 = Date.now();

  // Disable seq scan para forzar uso de GIST
  await c.query("SET LOCAL enable_seqscan = OFF");
  await c.query("SET LOCAL statement_timeout = '600s'");
  await c.query("BEGIN");

  // Query: para cada flight sin parcel_id, encontrar el parcel más cercano
  // dentro de 200m usando KNN (<->) y ST_DWithin como filtro de bounding.
  // Solo flights con lng/lat presentes y parcels no soft-deleted.
  const result = await c.query(`
    WITH orphan_flights AS (
      SELECT flight_id, lng, lat
      FROM dji_flights
      WHERE parcel_id IS NULL
        AND lng IS NOT NULL
        AND lat IS NOT NULL
    ),
    nearest AS (
      SELECT
        of.flight_id,
        p.id AS parcel_id,
        p.land_name,
        p.field_type,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(of.lng, of.lat), 4326)::geography,
          p.spray_geom::geography
        ) AS distance_m
      FROM orphan_flights of
      JOIN LATERAL (
        SELECT id, land_name, field_type, spray_geom
        FROM dji_parcels
        WHERE spray_geom IS NOT NULL
          AND deleted_at IS NULL
        ORDER BY spray_geom <-> ST_SetSRID(ST_MakePoint(of.lng, of.lat), 4326)
        LIMIT 5
      ) p ON true
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(of.lng, of.lat), 4326)::geography,
        p.spray_geom::geography,
        200
      )
    ),
    best AS (
      SELECT DISTINCT ON (flight_id) flight_id, parcel_id, land_name, field_type, distance_m
      FROM nearest
      ORDER BY flight_id, distance_m
    )
    UPDATE dji_flights f
    SET parcel_id = b.parcel_id,
        notes = f.notes || jsonb_build_object(
          'spatial_join', jsonb_build_object(
            'parcel_id', b.parcel_id,
            'land_name', b.land_name,
            'field_type', b.field_type,
            'distance_m', b.distance_m,
            'tolerance_m', 200,
            'joined_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          )
        )
    FROM best b
    WHERE f.flight_id = b.flight_id
    RETURNING f.flight_id
  `);

  console.log("Query done, rows affected:", result.rowCount, "in", ((Date.now()-t0)/1000).toFixed(1), "s");
  await c.query("COMMIT");

  // Stats
  const final = await c.query(`
    SELECT
      COUNT(*) FILTER (WHERE parcel_id IS NOT NULL) AS with_parcel,
      COUNT(*) FILTER (WHERE parcel_id IS NULL AND lng IS NOT NULL) AS orphan_with_geom,
      COUNT(*) FILTER (WHERE parcel_id IS NULL AND (lng IS NULL OR lat IS NULL)) AS truly_orphan
    FROM dji_flights
  `);
  console.log("Final state:", final.rows[0]);
  console.log("Total elapsed:", ((Date.now()-t0)/1000).toFixed(1), "s");
  await c.end();
})().catch(async e => { console.error("ERROR:", e.message); process.exit(1); });
