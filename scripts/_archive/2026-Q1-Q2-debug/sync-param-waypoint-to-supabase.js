#!/usr/bin/env node
// scripts/sync-param-waypoint-to-supabase.js
//
// Sincroniza los campos derivados de parameter.json + waypoint.json a
// dji_parcels. Idempotente: corre N veces = mismo resultado.
//
// Por qué existe:
//   El legacy import con los parameter.json/waypoint.json solo corrió contra
//   el docker local. La BD de Supabase tiene 1213 filas con metadata API
//   y polígonos (sync anterior) pero 0 campos de parameter/waypoint.
//
//   Este script rellena SOLO las columnas operativas y de plan de vuelo.
//   NO toca metadata API, NO toca polígonos, NO toca is_orchard (ya
//   correcto desde el backfill de la API).
//
// Columnas que popula (parameter.json):
//   drone_model_code, drone_model_name, spray_width_m, work_speed_mps,
//   optimal_heading_deg, radar_height_m, edge_offset_m, obstacle_offset_m,
//   climb_height_m, no_spray_zone_m2, droplet_size, sweep_direction,
//   spray_area_m2, uses_side_spray, raw_parameter
//
// Columnas que popula (waypoint.json):
//   waypoints (MultiPoint), waypoint_count (int), raw_waypoint (jsonb)
//
// NO popula:
//   declared_area_ha — DJI no expone área declarada por catálogo; en la BD
//   queda NULL hasta que el operador la cargue manualmente
//   (ver dji_fumigation_schedule + UI de edición)
//
// Uso:
//   node scripts/sync-param-waypoint-to-supabase.js
//   node scripts/sync-param-waypoint-to-supabase.js --db URL
//   node scripts/sync-param-waypoint-to-supabase.js --apply
//   node scripts/sync-param-waypoint-to-supabase.js --in djiag_exports/land_files

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

function createPool(connectionString) {
  let url, useSsl;
  if (connectionString) {
    url = connectionString;
    useSsl = url.includes("sslmode=require") || /supabase|aliyuncs|aws-/i.test(url);
  } else {
    url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
    useSsl = process.env.DATABASE_SSL === "true";
  }
  if (!url) throw new Error("DATABASE_URL no está en .env.local y no se pasó --db");
  return new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

// Coerce a number, return null if not a finite number.
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Boolean: JSON true/false → boolean; 1/0 también soportados.
function bool(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return null;
}

// Lookup de drone_model_code → drone_model_name. Replica el INSERT de
// db/schema.sql + supabase/migrations. Si el modelo no está, queda null.
const DRONE_MODEL_NAMES = {
  0: "Sin asignar",
  72: "Agras T16 / T20",
  201: "Agras T40 / T50",
  210: "Agras T70 / similar",
};

function parseParameter(param) {
  return {
    drone_model_code: num(param.land_connect_drone_type) ?? 0,
    drone_model_name: DRONE_MODEL_NAMES[num(param.land_connect_drone_type) ?? 0] ?? null,
    spray_width_m: num(param.spray_width),
    work_speed_mps: num(param.work_speed),
    optimal_heading_deg: num(param.spray_dir),
    radar_height_m: num(param.radar_height),
    edge_offset_m: num(param.edge_offset),
    obstacle_offset_m: num(param.obstacle_offset),
    climb_height_m: num(param.new_climb_height ?? param.land_climb_height),
    no_spray_zone_m2: num(param.no_spray_zone_area),
    droplet_size: num(param.droplet_size_new ?? param.droplet_size),
    sweep_direction: num(param.sweep_direction),
    spray_area_m2: num(param.inner_area),
    uses_side_spray: bool(param.is_use_side_spray),
  };
}

// Convierte waypoint.json (FeatureCollection of Points) a un MultiPoint
// GeoJSON listo para ST_GeomFromGeoJSON.
function waypointToMultiPointGeoJson(geo) {
  if (geo?.type !== "FeatureCollection" || !Array.isArray(geo.features)) return null;
  const coords = geo.features
    .filter((f) => f?.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates))
    .map((f) => f.geometry.coordinates);
  if (coords.length === 0) return null;
  return { type: "MultiPoint", coordinates: coords };
}

async function main() {
  loadLocalEnv();

  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const inIdx = args.indexOf("--in");
  const inDir = inIdx >= 0
    ? path.resolve(args[inIdx + 1])
    : path.join(process.cwd(), "djiag_exports", "land_files");
  const dbIdx = args.indexOf("--db");
  const dbUrl = dbIdx >= 0 ? args[dbIdx + 1] : null;

  if (!fs.existsSync(inDir)) throw new Error(`No existe: ${inDir}`);

  // Listar archivos
  const allFiles = fs.readdirSync(inDir);
  const paramFiles = new Map();
  const waypointFiles = new Map();
  for (const f of allFiles) {
    if (f.endsWith("_parameter.json")) {
      paramFiles.set(f.replace("_parameter.json", ""), path.join(inDir, f));
    } else if (f.endsWith("_waypoint.json")) {
      waypointFiles.set(f.replace("_waypoint.json", ""), path.join(inDir, f));
    }
  }
  console.log(`[sync-pw] ${paramFiles.size} parameter.json + ${waypointFiles.size} waypoint.json files`);

  // Para cada externalId, parsear lo que tengamos. parameter.json se procesa
  // para TODAS las 1213. waypoint.json solo para las 397 que lo tengan —
  // las otras 816 quedan con waypoints=NULL (es lo correcto: esas parcelas
  // no tienen un plan de vuelo planificado por el operador).
  const extIds = new Set([...paramFiles.keys(), ...waypointFiles.keys()]);
  console.log(`[sync-pw] ${extIds.size} externalIds únicos (parameter: ${paramFiles.size}, waypoint: ${waypointFiles.size})`);

  const dbHost = new URL(dbUrl ?? process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT ?? "postgresql://x").host;
  console.log(`[sync-pw] target: ${dbHost}`);

  const pool = createPool(dbUrl);
  const client = await pool.connect();
  try {
    // Cargar externalIds existentes en BD destino
    const extIdArr = Array.from(extIds);
    const existing = await client.query(
      `SELECT external_id FROM dji_parcels WHERE external_id = ANY($1::text[])`,
      [extIdArr]
    );
    const existingSet = new Set(existing.rows.map((r) => r.external_id));
    console.log(`[sync-pw] Filas existentes en BD destino: ${existingSet.size}/${extIds.size}`);

    // Parsear y preparar batch
    const records = [];
    let nParamParseErr = 0;
    let nWpParseErr = 0;
    let nSkippedNoRow = 0;
    for (const extId of extIds) {
      if (!existingSet.has(extId)) { nSkippedNoRow++; continue; }

      let paramRaw, paramNorm, wpRaw, wpMulti;
      // parameter: si existe, parsearlo. Si no, saltar (no debería pasar — todas
      // las filas en dji_parcels deberían tener parameter.json).
      if (paramFiles.has(extId)) {
        try {
          paramRaw = JSON.parse(fs.readFileSync(paramFiles.get(extId), "utf-8"));
          paramNorm = parseParameter(paramRaw);
        } catch (e) { nParamParseErr++; continue; }
      } else {
        nParamParseErr++;
        continue;
      }

      // waypoint: opcional. Si no existe, dejar los campos en NULL.
      if (waypointFiles.has(extId)) {
        try {
          wpRaw = JSON.parse(fs.readFileSync(waypointFiles.get(extId), "utf-8"));
          wpMulti = waypointToMultiPointGeoJson(wpRaw);
        } catch (e) { nWpParseErr++; }
      }

      records.push({
        extId,
        ...paramNorm,
        waypoint_count: wpMulti?.coordinates.length ?? null,
        waypoints_json: wpMulti ? JSON.stringify(wpMulti) : null,
        raw_parameter_json: JSON.stringify(paramRaw),
        raw_waypoint_json: wpRaw ? JSON.stringify(wpRaw) : null,
      });
    }

    console.log(`[sync-pw] Records a escribir: ${records.length}`);
    console.log(`[sync-pw] Skipped (sin fila en BD): ${nSkippedNoRow}`);
    console.log(`[sync-pw] Errores parse param: ${nParamParseErr}, parse waypoint: ${nWpParseErr}`);

    if (!apply) {
      console.log(`\n[sync-pw] DRY RUN — sin cambios en BD. Pasá --apply para aplicar.`);
      return;
    }

    console.log(`\n[sync-pw] APLICANDO...`);
    await client.query("BEGIN");

    let nUpdated = 0;
    let nErrors = 0;
    const sampleErrors = [];
    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      for (const r of batch) {
        try {
          const sql = `
            UPDATE dji_parcels
            SET
              drone_model_code   = $1,
              drone_model_name   = $2,
              spray_width_m      = $3,
              work_speed_mps     = $4,
              optimal_heading_deg= $5,
              radar_height_m     = $6,
              edge_offset_m      = $7,
              obstacle_offset_m  = $8,
              climb_height_m     = $9,
              no_spray_zone_m2   = $10,
              droplet_size       = $11,
              sweep_direction    = $12,
              spray_area_m2      = $13,
              uses_side_spray    = $14,
              raw_parameter      = $15::jsonb,
              waypoint_count     = $16,
              waypoints          = CASE WHEN $17::text IS NULL THEN NULL
                                       ELSE ST_Force2D(ST_GeomFromGeoJSON($17::text)) END,
              raw_waypoint       = $18::jsonb
            WHERE external_id = $19
          `;
          await client.query(sql, [
            r.drone_model_code, r.drone_model_name, r.spray_width_m, r.work_speed_mps,
            r.optimal_heading_deg, r.radar_height_m, r.edge_offset_m, r.obstacle_offset_m,
            r.climb_height_m, r.no_spray_zone_m2, r.droplet_size, r.sweep_direction,
            r.spray_area_m2, r.uses_side_spray, r.raw_parameter_json, r.waypoint_count,
            r.waypoints_json, r.raw_waypoint_json, r.extId,
          ]);
          nUpdated++;
        } catch (err) {
          nErrors++;
          if (sampleErrors.length < 5) {
            sampleErrors.push({ extId: r.extId, error: err.message.slice(0, 200) });
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`[sync-pw] OK:`);
    console.log(`  updated:        ${nUpdated}`);
    console.log(`  errors:         ${nErrors}`);
    if (sampleErrors.length > 0) {
      console.log(`  Errores (muestra):`);
      sampleErrors.forEach((e) => console.log(`    ${e.extId}: ${e.error}`));
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[sync-pw] ERROR:", err);
    process.exit(1);
  });
}

module.exports = { main, parseParameter, waypointToMultiPointGeoJson };
