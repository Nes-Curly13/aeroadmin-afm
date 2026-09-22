#!/usr/bin/env node
// scripts/assign-orphan-parcels.js
//
// Asigna parcela a las fumigaciones huerfanas intersectando su COBERTURA
// con las parcelas. Criterio: la parcela con mayor area de interseccion
// (prefiriendo source='dji' sobre 'imported'). Opcional: umbral minimo de
// interseccion (fraccion de la cobertura y/o m2).
//
// Uso:
//   node scripts/assign-orphan-parcels.js                 # dry-run
//   node scripts/assign-orphan-parcels.js --apply
//   node scripts/assign-orphan-parcels.js --min-frac 0.05 --apply
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
  const a = { apply: false, minFrac: 0, minM2: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--min-frac" && argv[i + 1]) a.minFrac = Number(argv[++i]);
    else if (argv[i] === "--min-m2" && argv[i + 1]) a.minM2 = Number(argv[++i]);
  }
  return a;
}

// Candidatos: interseccion cobertura-parcela, rankeado por (pref source, area).
const CAND = `
  WITH o AS (
    SELECT f.id, ST_MakeValid(f.coverage) AS coverage
      FROM dji_fumigations f
     WHERE f.deleted_at IS NULL AND f.parcel_id IS NULL AND f.coverage IS NOT NULL
  ),
  c AS (
    SELECT o.id AS fumigation_id, p.id AS parcel_id, p.source,
           ST_Area(ST_Intersection(o.coverage, p.spray_geom)::geography) AS inter_m2,
           ST_Area(o.coverage::geography) AS cov_m2,
           ROW_NUMBER() OVER (
             PARTITION BY o.id
             ORDER BY (CASE WHEN p.source='dji' THEN 0 ELSE 1 END),
                      ST_Area(ST_Intersection(o.coverage, p.spray_geom)::geography) DESC
           ) AS rn
      FROM o
      JOIN dji_parcels p
        ON p.deleted_at IS NULL AND p.spray_geom IS NOT NULL
       AND ST_Intersects(o.coverage, p.spray_geom)
  )
  SELECT fumigation_id, parcel_id, source, inter_m2, cov_m2,
         (inter_m2 / NULLIF(cov_m2,0)) AS frac
    FROM c WHERE rn = 1`;

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const c = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  await c.query("SET statement_timeout = '15min'");
  try {
    const total = await c.query(
      `SELECT count(*)::int n FROM dji_fumigations WHERE deleted_at IS NULL AND parcel_id IS NULL AND coverage IS NOT NULL`
    );
    console.log(`[assign] huérfanas con cobertura: ${total.rows[0].n}`);

    const stats = await c.query(
      `WITH cand AS (${CAND})
       SELECT count(*)::int con_interseccion,
              count(*) FILTER (WHERE source='dji')::int con_dji,
              count(*) FILTER (WHERE frac >= 0.01)::int frac_ge_1pct,
              count(*) FILTER (WHERE frac >= 0.05)::int frac_ge_5pct,
              count(*) FILTER (WHERE frac >= 0.10)::int frac_ge_10pct,
              count(*) FILTER (WHERE frac >= 0.50)::int frac_ge_50pct,
              round(percentile_disc(0.5) WITHIN GROUP (ORDER BY frac)::numeric,3) mediana_frac
         FROM cand`
    );
    console.log("[assign] stats:", stats.rows[0]);

    const sample = await c.query(
      `WITH cand AS (${CAND})
       SELECT c.fumigation_id, c.parcel_id, c.source, round(c.inter_m2)::int inter_m2,
              round(c.cov_m2)::int cov_m2, round(c.frac::numeric,3) frac, p.land_name, p.farm_name
         FROM cand c JOIN dji_parcels p ON p.id = c.parcel_id
        ORDER BY c.frac DESC LIMIT 8`
    );
    console.log("[assign] muestra (mejores):");
    for (const r of sample.rows) {
      console.log(`  #${r.fumigation_id} → ${r.source} #${r.parcel_id} ${r.land_name || ""} (${r.farm_name || ""}) inter ${r.inter_m2}/${r.cov_m2} m² (${(r.frac * 100).toFixed(0)}%)`);
    }

    if (!args.apply) {
      console.log("[assign] DRY-RUN (no escribe). Ajustá con --min-frac / --min-m2 y corré con --apply.");
      return;
    }

    const upd = await c.query(
      `WITH cand AS (${CAND})
       UPDATE dji_fumigations f
          SET parcel_id = cand.parcel_id,
              needs_parcel_assignment = false,
              assignment_note = NULL
         FROM cand
        WHERE f.id = cand.fumigation_id
          AND cand.frac >= $1
          AND cand.inter_m2 >= $2
        RETURNING f.id, f.parcel_id`,
      [args.minFrac, args.minM2]
    );
    console.log(`[assign] ${upd.rowCount ?? 0} fumigaciones asignadas`);

    const fl = await c.query(
      `UPDATE dji_flights fl
          SET parcel_id = f.parcel_id
         FROM dji_fumigations f
        WHERE fl.flight_id = ANY(f.flight_ids)
          AND fl.parcel_id IS NULL
          AND f.parcel_id IS NOT NULL
          AND f.deleted_at IS NULL
          AND f.source='import' AND f.session_key IS NOT NULL`
    );
    console.log(`[assign] ${fl.rowCount ?? 0} vuelos con parcela propagada`);
  } finally {
    await c.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("[assign] ERROR:", e && e.message ? e.message : e); process.exit(1); });
}
module.exports = { main };
