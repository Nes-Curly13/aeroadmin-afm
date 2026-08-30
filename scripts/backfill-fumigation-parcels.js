// Backfill: popula dji_fumigations.parcels[] desde flight_ids[]
// Sprint S9 — feature/multi-parcela-fumigation
//
// Para cada fumigación con flight_ids[]:
//   1. JOIN flight_ids[] con dji_flights por flight_id (DJI external)
//   2. JOIN dji_flights.parcel_id con dji_parcels
//   3. Toma los parcel_external_id distintos, excluyendo la primaria
//   4. UPDATE dji_fumigations SET parcels = array_agg(external_id)
//
// IMPORTANTE: flight_ids[] contiene dji_flights.flight_id (DJI external),
// NO dji_flights.id (internal PK). Bug pre-existente documentado en
// la migration. Ver docs/reviews/flights-csv-export-review.md.
//
// Idempotente: corre 2 veces no duplica ni rompe.

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadLocalEnv();
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === "true";
  if (!connectionString) throw new Error("DATABASE_URL not configured");

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 30000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });

  const client = await pool.connect();
  try {
    // 0. Aplicar la migration si no está aplicada (idempotente)
    console.log("[backfill] Verificando migration…");
    await client.query(`
      ALTER TABLE dji_fumigations ADD COLUMN IF NOT EXISTS parcels text[];
      UPDATE dji_fumigations SET parcels = '{}' WHERE parcels IS NULL;
      CREATE INDEX IF NOT EXISTS idx_dji_fumigations_parcels_gin
        ON dji_fumigations USING GIN (parcels)
        WHERE parcels IS NOT NULL AND array_length(parcels, 1) > 0;
    `);

    // 1. Estado antes
    const before = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE parcels IS NOT NULL AND array_length(parcels,1) > 0) AS with_secondary,
        COUNT(*) FILTER (WHERE parcels IS NULL OR array_length(parcels,1) = 0) AS without_secondary,
        COUNT(*) FILTER (WHERE flight_ids IS NOT NULL AND array_length(flight_ids,1) > 0) AS with_flight_ids
      FROM dji_fumigations
    `);
    console.log("[backfill] Estado ANTES:", before.rows[0]);

    // 2. Backfill: para cada fumigación con flight_ids, derivar las suertes
    // secundarias. La primaria = parcel_id. Las demás van en parcels[].
    console.log("[backfill] Ejecutando backfill (puede tomar 1-2 min)…");
    const t0 = Date.now();
    const result = await client.query(`
      WITH flight_parcels AS (
        SELECT
          f2.id AS fumigation_id,
          f2.parcel_id AS primary_parcel,
          p.external_id AS parcel_external,
          p.id AS parcel_internal,
          COUNT(*) AS n_flights_in_parcel
        FROM dji_fumigations f2
        CROSS JOIN LATERAL unnest(f2.flight_ids) AS u(dji_fid)
        INNER JOIN dji_flights fl ON fl.flight_id = u.dji_fid
        INNER JOIN dji_parcels p ON p.id = fl.parcel_id
        WHERE f2.flight_ids IS NOT NULL
          AND array_length(f2.flight_ids, 1) > 0
          AND p.deleted_at IS NULL
        GROUP BY f2.id, f2.parcel_id, p.external_id, p.id
      ),
      secondary_parcels AS (
        SELECT
          fumigation_id,
          primary_parcel,
          ARRAY_AGG(parcel_external ORDER BY n_flights_in_parcel DESC, parcel_external) AS secondary_ids
        FROM flight_parcels
        WHERE parcel_internal != primary_parcel  -- excluye la primaria
        GROUP BY fumigation_id, primary_parcel
      )
      UPDATE dji_fumigations f
      SET parcels = COALESCE(sp.secondary_ids, '{}')
      FROM secondary_parcels sp
      WHERE f.id = sp.fumigation_id
      RETURNING f.id
    `);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[backfill] ${result.rowCount} fumigaciones actualizadas en ${elapsed}s`);

    // 3. Estado después
    const after = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE parcels IS NOT NULL AND array_length(parcels,1) > 0) AS with_secondary,
        COUNT(*) FILTER (WHERE parcels IS NULL OR array_length(parcels,1) = 0) AS without_secondary,
        COUNT(*) FILTER (WHERE parcels IS NOT NULL AND array_length(parcels,1) >= 3) AS with_3plus,
        COUNT(*) FILTER (WHERE array_length(parcels,1) >= 5) AS with_5plus
      FROM dji_fumigations
    `);
    console.log("[backfill] Estado DESPUÉS:", after.rows[0]);

    // 4. Top fumigaciones con más suertes secundarias
    const top = await client.query(`
      SELECT
        f.id, f.fumigation_date, f.parcel_id,
        p.land_name AS primary_parcel,
        array_length(f.parcels, 1) AS n_secondary,
        f.parcels
      FROM dji_fumigations f
      LEFT JOIN dji_parcels p ON p.id = f.parcel_id
      WHERE f.parcels IS NOT NULL AND array_length(f.parcels, 1) > 0
      ORDER BY array_length(f.parcels, 1) DESC
      LIMIT 8
    `);
    console.log("\n[backfill] TOP 8 fumigaciones con más suertes secundarias:");
    console.table(top.rows);
  } catch (e) {
    console.error("[backfill] ERROR:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
