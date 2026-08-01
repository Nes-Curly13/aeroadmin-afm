#!/usr/bin/env node
// scripts/sync-polygons-to-supabase.js
//
// Sincroniza los polígonos (spray_geom, reference_point, raw_geometry) desde
// los geometry.json descargados (djiag_exports/land_files/) a dji_parcels.
// Idempotente: corre N veces = mismo resultado.
//
// Por qué existe:
//   El legacy import que descarga los geometry.json y popula spray_geom/
//   reference_point/raw_geometry solo corrió contra el docker local. La BD
//   de producción (Supabase) tiene 1213 filas con metadata completa
//   (land_name, position, bbox, MU areas) pero 0 polígonos.
//
//   Este script rellena SOLO las columnas geométricas. NO toca metadata
//   API, NO toca parameter.json fields, NO toca waypoints. Para esos, hace
//   falta otro script (o re-correr el legacy import completo).
//
// Uso:
//   node scripts/sync-polygons-to-supabase.js
//   node scripts/sync-polygons-to-supabase.js --db URL
//   node scripts/sync-polygons-to-supabase.js --apply
//   node scripts/sync-polygons-to-supabase.js --in djiag_exports/land_files
//
// Default: dry-run (no escribe). --apply para ejecutar.

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

function loadGeometryFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("_geometry.json"))
    .map((f) => {
      const extId = f.replace("_geometry.json", "");
      const full = path.join(dir, f);
      const content = JSON.parse(fs.readFileSync(full, "utf-8"));
      return { extId, geo: content, rawJson: content };
    });
}

function extractPlantZone(geo) {
  if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) return null;
  const f = geo.features.find(
    (ft) => ft?.properties?.funcType === "PlantZone" && ft.geometry
  );
  return f?.geometry ?? null;
}

function extractReferencePoint(geo) {
  if (geo.type !== "FeatureCollection" || !Array.isArray(geo.features)) return null;
  const f = geo.features.find(
    (ft) => ft?.properties?.funcType === "ReferencePoint"
  );
  // Si no hay features, o coords vacías, devolvemos null (evita geometrías vacías)
  if (!f || !f.geometry || !Array.isArray(f.geometry.coordinates)) return null;
  if (f.geometry.coordinates.length === 0) return null;
  // DJI devuelve MultiPoint pero la columna es Point (4326). Si tiene exactamente
  // 1 punto, extraemos ese punto. Si tiene más, conservamos solo el primero
  // (alternativa: fallar — pero DJI en la práctica siempre manda 0 o 1 punto).
  if (f.geometry.type === "MultiPoint") {
    if (f.geometry.coordinates.length === 1) {
      const [lng, lat] = f.geometry.coordinates[0];
      return { type: "Point", coordinates: [lng, lat] };
    }
    // Si tiene 0 (no debería porque ya chequeamos arriba) o >1, conservamos el primero
    if (f.geometry.coordinates.length > 1) {
      const [lng, lat] = f.geometry.coordinates[0];
      return { type: "Point", coordinates: [lng, lat] };
    }
  }
  if (f.geometry.type === "Point") {
    return f.geometry;
  }
  return null;
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
  const files = loadGeometryFiles(inDir);
  console.log(`[sync-polygons] ${files.length} geometry.json files en ${path.basename(inDir)}`);
  const dbHost = new URL(dbUrl ?? process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT ?? "postgresql://x").host;
  console.log(`[sync-polygons] target: ${dbHost}`);

  // Parsear
  let nWithPlant = 0;
  let nWithRef = 0;
  const sampleMissingExtId = []; // geometry.json sin fila en BD
  const sampleBadGeometry = [];
  for (const f of files) {
    const pz = extractPlantZone(f.geo);
    if (pz) nWithPlant++;
    const ref = extractReferencePoint(f.geo);
    if (ref) nWithRef++;
  }
  console.log(`[sync-polygons] Con PlantZone: ${nWithPlant}/${files.length}`);
  console.log(`[sync-polygons] Con ReferencePoint no vacío: ${nWithRef}/${files.length}`);

  const pool = createPool(dbUrl);
  const client = await pool.connect();
  try {
    // Verificar cuántas externalIds existen en la BD destino
    const existing = await client.query(
      `SELECT external_id FROM dji_parcels WHERE external_id = ANY($1::text[])`,
      [files.map((f) => f.extId)]
    );
    const existingSet = new Set(existing.rows.map((r) => r.external_id));
    const nMissingInBd = files.length - existingSet.size;
    console.log(`[sync-polygons] Filas existentes en BD destino: ${existingSet.size}/${files.length}`);
    if (nMissingInBd > 0) {
      console.log(`[sync-polygons] ⚠️  ${nMissingInBd} geometry.json NO tienen fila en BD (serán skipped)`);
    }

    if (!apply) {
      console.log(`\n[sync-polygons] DRY RUN — sin cambios en BD. Pasá --apply para aplicar.`);
      return;
    }

    console.log(`\n[sync-polygons] APLICANDO en transacción...`);
    await client.query("BEGIN");

    let nUpdated = 0;
    let nSkippedNoExtId = 0;
    let nSkippedNoPlant = 0;
    let nSkippedNoRow = 0;
    let nErrors = 0;
    let nWithRefWritten = 0;
    const sampleErrors = [];

    for (const f of files) {
      if (!f.extId) {
        nSkippedNoExtId++;
        continue;
      }
      if (!existingSet.has(f.extId)) {
        nSkippedNoRow++;
        continue;
      }
      const pz = extractPlantZone(f.geo);
      if (!pz) {
        nSkippedNoPlant++;
        continue;
      }
      const ref = extractReferencePoint(f.geo);

      // Convertir a GeoJSON string para ST_GeomFromGeoJSON.
      // Forzamos 2D (Z=0) porque ST_GeomFromGeoJSON a veces tiene problemas con 3D.
      const pzJson = JSON.stringify(pz);
      const refJson = ref ? JSON.stringify(ref) : null;
      const rawJson = JSON.stringify(f.geo);

      try {
        // UPSERT solo sobre las columnas geométricas. NO toca metadata API
        // ni parameter fields.
        // NOTA: NO usamos ST_Buffer(geom, 0) porque ese "no-op" en realidad
        // simplifica agresivamente la geometría y cambia el área (ej: 382
        // vértices / 10966m² → 139 / 3745 en PostGIS 3.4, o 327 / 14712
        // en PostGIS 3.3). El comportamiento es no-determinístico entre
        // versiones, así que lo evitamos y preservamos la geometría exacta.
        const sql = `
          UPDATE dji_parcels
          SET
            spray_geom      = ST_Multi(ST_Force2D(ST_GeomFromGeoJSON($1::text))),
            reference_point = CASE WHEN $2::text IS NULL THEN NULL
                                  ELSE ST_Force2D(ST_GeomFromGeoJSON($2::text)) END,
            raw_geometry    = $3::jsonb
          WHERE external_id = $4
        `;
        const r = await client.query(sql, [pzJson, refJson, rawJson, f.extId]);
        if (r.rowCount > 0) {
          nUpdated++;
          if (refJson) nWithRefWritten++;
        } else {
          nSkippedNoRow++;
        }
      } catch (err) {
        nErrors++;
        if (sampleErrors.length < 5) {
          sampleErrors.push({ extId: f.extId, error: err.message.slice(0, 200) });
        }
      }
    }

    await client.query("COMMIT");
    console.log(`[sync-polygons] OK:`);
    console.log(`  updated:           ${nUpdated}`);
    console.log(`  con ref_point:     ${nWithRefWritten}`);
    console.log(`  skipped no extId:  ${nSkippedNoExtId}`);
    console.log(`  skipped no Plant:  ${nSkippedNoPlant}`);
    console.log(`  skipped no row:    ${nSkippedNoRow}`);
    console.log(`  errors:            ${nErrors}`);
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
    console.error("[sync-polygons] ERROR:", err);
    process.exit(1);
  });
}

module.exports = { main };
