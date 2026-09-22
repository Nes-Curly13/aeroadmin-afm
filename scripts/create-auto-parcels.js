#!/usr/bin/env node
// scripts/create-auto-parcels.js
//
// Crea una PARCELA automatica por cada fumigacion huerfana que no intersecta
// ninguna parcela existente, usando su COBERTURA como geometria. Asi todas
// las fumigaciones quedan con parcela (source='imported',
// data_validity='needs_review', external_id='cov-auto-<fumigation_id>').
//
// Uso:
//   node scripts/create-auto-parcels.js            # dry-run
//   node scripts/create-auto-parcels.js --apply
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

const CAND = `
  WITH cand AS (
    SELECT f.id AS fumigation_id,
           ST_Multi(
             CASE
               WHEN f.coverage IS NOT NULL AND ST_Area(f.coverage) > 0
                 THEN ST_CollectionExtract(ST_MakeValid(f.coverage), 3)
               WHEN h.geom IS NOT NULL AND ST_Area(h.geom) > 0
                 THEN ST_CollectionExtract(ST_MakeValid(h.geom), 3)
               WHEN COALESCE(h.geom, f.coverage) IS NOT NULL
                 THEN ST_Buffer(ST_Centroid(COALESCE(h.geom, f.coverage)), 0.0008)
               ELSE NULL
             END
           ) AS geom,
           f.fumigation_date
      FROM dji_fumigations f
      LEFT JOIN mv_fumigation_hulls h ON h.fumigation_id = f.id
     WHERE f.deleted_at IS NULL AND f.parcel_id IS NULL
       AND f.source='import' AND f.session_key IS NOT NULL
       AND (f.coverage IS NOT NULL OR h.geom IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1 FROM dji_parcels p WHERE p.external_id = 'cov-auto-'||f.id
       )
  )`;

async function main() {
  loadLocalEnv();
  const apply = process.argv.includes("--apply");
  const c = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await c.connect();
  await c.query("SET statement_timeout = '15min'");
  try {
    const stats = await c.query(
      `${CAND} SELECT count(*)::int n, round(sum(ST_Area(geom::geography))/10000)::int ha FROM cand`
    );
    console.log(`[auto-parcel] candidatas: ${stats.rows[0].n} · ${stats.rows[0].ha} ha`);

    const sample = await c.query(
      `${CAND} SELECT fumigation_id, round((ST_Area(geom::geography)/10000)::numeric,2) ha FROM cand ORDER BY ha DESC LIMIT 6`
    );
    console.log("[auto-parcel] muestra:", sample.rows);

    if (!apply) {
      console.log("[auto-parcel] DRY-RUN (no escribe). Corré con --apply.");
      return;
    }

    await c.query("BEGIN");
    const ins = await c.query(
      `${CAND},
       ins AS (
         INSERT INTO dji_parcels
           (external_id, land_name, field_type, source, data_validity, is_orchard, spray_geom, declared_area_ha)
         SELECT 'cov-auto-'||c.fumigation_id,
                'Auto '||c.fumigation_date||' #'||c.fumigation_id,
                'Farmland', 'imported', 'needs_review', false,
                c.geom, ST_Area(c.geom::geography)/10000
           FROM cand c
         RETURNING id, external_id
       )
       UPDATE dji_fumigations f
          SET parcel_id = ins.id, needs_parcel_assignment = false, assignment_note = NULL
         FROM ins
        WHERE ins.external_id = 'cov-auto-'||f.id
        RETURNING f.id`
    );
    const nFums = ins.rowCount ?? 0;
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
    await c.query("COMMIT");
    console.log(`[auto-parcel] OK: ${nFums} parcelas creadas/asignadas · ${fl.rowCount ?? 0} vuelos propagados`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => { console.error("[auto-parcel] ERROR:", e && e.message ? e.message : e); process.exit(1); });
}
module.exports = { main };
