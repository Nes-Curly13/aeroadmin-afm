#!/usr/bin/env node
// scripts/regroup-fumigations-dbscan.js
//
// Reagrupa los vuelos en fumigaciones con la regla **día + DBSCAN espacial**
// (eps configurable, default 330 m) usando los TRACKS KML, y calcula la
// cobertura real de cada grupo (buffer 2 m + unión).
//
// Regla (2026-09-21, decisión del operador):
//   - Cluster = ST_ClusterDBSCAN(track.geom, eps, minpoints=1) sobre TODOS
//     los tracks; luego se parte por día (Bogota). Cada (cluster, día) es
//     una fumigación.
//   - parcel_id: si TODOS los vuelos del grupo comparten parcela, se asigna;
//     si no, NULL + needs_parcel_assignment = true.
//   - session_key determinista: 'dbscan|<día>|<min flight_id>'.
//
// Reemplaza las fumigaciones de import previas (source='import' y
// session_key NOT NULL). No toca manuales ni asignaciones ajenas.
//
// Uso:
//   node scripts/regroup-fumigations-dbscan.js               # dry-run
//   node scripts/regroup-fumigations-dbscan.js --apply
//   node scripts/regroup-fumigations-dbscan.js --eps 0.003 --apply
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
  const a = { apply: false, eps: 0.003 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--eps" && argv[i + 1]) a.eps = Number(argv[++i]);
  }
  return a;
}

// CTE comun de agrupacion.
const GROUPS_CTE = (eps) => `
  WITH t AS (
    SELECT tr.flight_id, tr.geom, fl.parcel_id, fl.drone_nickname, fl.pilot_name,
           COALESCE(fl.area_m2,0)::numeric AS area_m2,
           COALESCE(fl.spray_usage_ml,0)::numeric AS spray_ml,
           COALESCE(fl.duration_seconds,0)::numeric AS dur_s,
           to_char(fl.start_at AT TIME ZONE 'America/Bogota','YYYY-MM-DD') AS day
      FROM dji_flight_tracks tr
      JOIN dji_flights fl ON fl.flight_id = tr.flight_id
     WHERE tr.geom IS NOT NULL AND fl.start_at IS NOT NULL
  ),
  cl AS (SELECT *, ST_ClusterDBSCAN(geom, eps := ${eps}, minpoints := 1) OVER () AS cid FROM t),
  g AS (
    SELECT cid, day,
           min(flight_id) AS min_fid,
           array_agg(flight_id ORDER BY flight_id)::int[] AS flight_ids,
           count(*)::int AS flight_count,
           sum(area_m2)::numeric AS area_m2_total,
           sum(spray_ml)::numeric AS spray_usage_total,
           round(sum(dur_s)/60)::int AS duration_minutes,
           mode() WITHIN GROUP (ORDER BY drone_nickname) AS drone,
           mode() WITHIN GROUP (ORDER BY pilot_name) AS pilot,
           CASE WHEN count(DISTINCT parcel_id) = 1 THEN min(parcel_id) ELSE NULL END AS parcel_id,
           ST_Multi(ST_Simplify(
             ST_Multi(ST_CollectionExtract(ST_MakeValid(
               ST_UnaryUnion(ST_Collect(ST_Buffer(geom::geography, 2.0)::geometry))
             ),3)), 0.0002)) AS coverage
      FROM cl GROUP BY cid, day
  )`;

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
    const stats = await client.query(
      `${GROUPS_CTE(args.eps)}
       SELECT count(*)::int groups, sum(flight_count)::int flights,
              count(*) FILTER (WHERE parcel_id IS NULL)::int orphans,
              count(*) FILTER (WHERE flight_count=1)::int singles,
              round(avg(flight_count)::numeric,1) avg_n,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY flight_count) median_n,
              max(flight_count)::int max_n
         FROM g`
    );
    console.log(`[regroup] eps=${args.eps} (~${Math.round(args.eps * 111320)} m):`, stats.rows[0]);

    if (!args.apply) {
      console.log("[regroup] DRY-RUN (no escribe). Corré con --apply para reemplazar las fumigaciones de import.");
      return;
    }

    await client.query("BEGIN");
    const del = await client.query(
      "DELETE FROM dji_fumigations WHERE source='import' AND session_key IS NOT NULL"
    );
    console.log(`  reset: ${del.rowCount} fumigaciones de import previas borradas`);

    const ins = await client.query(
      `${GROUPS_CTE(args.eps)}
       INSERT INTO dji_fumigations (
         parcel_id, fumigation_date, area_fumigated_m2, duration_minutes,
         notes, recorded_by, source, flight_ids, parcels,
         needs_parcel_assignment, assignment_note, session_key,
         coverage, flight_count, area_m2_total, spray_usage_total
       )
       SELECT g.parcel_id, g.day::date, g.area_m2_total, g.duration_minutes,
              jsonb_build_object('import','track-dbscan','eps_m',${Math.round(args.eps * 111320)},
                                 'flights',g.flight_count,'drone',g.drone,'pilot',g.pilot),
              'djiag-import','import', g.flight_ids, '{}',
              g.parcel_id IS NULL,
              CASE WHEN g.parcel_id IS NULL
                   THEN g.flight_count || ' vuelos sin parcela (' || g.day || '). Asignar parcela.'
                   ELSE NULL END,
              'dbscan|' || g.day || '|' || g.min_fid,
              g.coverage, g.flight_count, g.area_m2_total, g.spray_usage_total
         FROM g`
    );
    await client.query("COMMIT");
    console.log(`[regroup] OK: ${ins.rowCount ?? 0} fumigaciones creadas`);

    console.log("[regroup] refrescando MVs...");
    const { main: refresh } = require("./refresh-fumigations");
    await refresh();
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[regroup] ERROR:", e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { main };
