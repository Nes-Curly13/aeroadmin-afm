#!/usr/bin/env node
// scripts/recompute-fumigation-coverage.js
//
// Calcula la COBERTURA real de cada fumigacion a partir de los tracks KML:
//   coverage = ST_Multi(ST_CollectionExtract(ST_MakeValid(
//                ST_UnaryUnion(ST_Collect(ST_Buffer(track::geography, 2.0)::geometry))
//              ), 3))
// y de paso setea flight_count / area_m2_total / spray_usage_total.
//
// Es el mismo calculo del pipeline viejo (djiag sync). Reemplaza al
// convex hull de puntos que generaba las "franjas" en el geovisor.
//
// Uso:
//   node scripts/recompute-fumigation-coverage.js            # dry-run
//   node scripts/recompute-fumigation-coverage.js --apply
//   node scripts/recompute-fumigation-coverage.js --apply --batch 150
//
// Env (.env.local): DATABASE_URL, DATABASE_SSL.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

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

function parseArgs(argv) {
  const a = { apply: false, batch: 150 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--batch" && argv[i + 1]) a.batch = Math.max(1, Number(argv[++i]));
  }
  return a;
}

// Fumigaciones con al menos 1 vuelo con track.
const TARGET_SQL = `
  SELECT f.id::bigint AS id
    FROM dji_fumigations f
   WHERE f.deleted_at IS NULL
     AND f.flight_ids IS NOT NULL
     AND array_length(f.flight_ids, 1) > 0
     AND EXISTS (
       SELECT 1 FROM dji_flights fl
        WHERE fl.flight_id = ANY(f.flight_ids) AND fl.track IS NOT NULL
     )
   ORDER BY f.id`;

const UPDATE_SQL = `
  WITH agg AS (
    SELECT f.id AS fumigation_id,
           count(fl.*)::int AS flight_count,
           COALESCE(sum(fl.area_m2), 0)::numeric AS area_m2_total,
           COALESCE(sum(fl.spray_usage_ml), 0)::numeric AS spray_usage_total,
           ST_Multi(ST_CollectionExtract(ST_MakeValid(
             ST_UnaryUnion(ST_Collect(ST_Buffer(fl.track::geography, 2.0)::geometry))
           ), 3)) AS coverage
      FROM dji_fumigations f
      JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
     WHERE f.id = ANY($1::bigint[])
       AND fl.track IS NOT NULL
     GROUP BY f.id
  )
  UPDATE dji_fumigations f
     SET coverage = agg.coverage,
         flight_count = agg.flight_count,
         area_m2_total = agg.area_m2_total,
         spray_usage_total = agg.spray_usage_total
    FROM agg
   WHERE f.id = agg.fumigation_id
  RETURNING f.id`;

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query("SET statement_timeout = '15min'");
  try {
    const target = await client.query(TARGET_SQL);
    const ids = target.rows.map((r) => Number(r.id));
    console.log(`[coverage] fumigaciones con tracks: ${ids.length}`);
    if (ids.length === 0) {
      console.log("[coverage] no hay tracks en dji_flights; corré primero import-flight-tracks.js");
      return;
    }
    if (!args.apply) {
      const sample = await client.query(
        `SELECT ST_Area(ST_Multi(ST_CollectionExtract(ST_MakeValid(
                  ST_UnaryUnion(ST_Collect(ST_Buffer(fl.track::geography, 2.0)::geometry))
                ),3))::geography) / 10000.0 AS ha
           FROM dji_fumigations f JOIN dji_flights fl ON fl.flight_id = ANY(f.flight_ids)
          WHERE f.id = $1 AND fl.track IS NOT NULL`,
        [ids[0]]
      );
      console.log(`[coverage] DRY-RUN. Ejemplo fumigacion #${ids[0]}: cobertura ${Number(sample.rows[0]?.ha ?? 0).toFixed(2)} ha`);
      console.log("[coverage] para escribir: --apply");
      return;
    }
    let done = 0;
    for (let i = 0; i < ids.length; i += args.batch) {
      const chunk = ids.slice(i, i + args.batch);
      const res = await client.query(UPDATE_SQL, [chunk]);
      done += res.rowCount ?? 0;
      console.log(`  cobertura: ${done}/${ids.length}`);
    }
    console.log(`[coverage] OK: ${done} fumigaciones con cobertura`);
    console.log("[coverage] refrescá las MVs: node scripts/refresh-fumigations.js");
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[coverage] ERROR:", e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { main };
