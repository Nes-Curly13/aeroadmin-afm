#!/usr/bin/env node
// scripts/backfill-lands-geometry.js
//
// Aplica la geometria de los lands DJI (spray_geom + reference_point) a
// `dji_parcels` a partir de los assets descargados en
// `djiag_exports/land_files/<externalId>_geometry.json`.
//
// Contexto (handoff 2026-09-20, SS2 y SS3-bis):
//   El GraphQL de DJI NO devuelve la geometria inline: devuelve signed URLs
//   a un FeatureCollection con un PlantZone (Polygon) + un ReferencePoint
//   (MultiPoint, casi siempre vacio). `npm run upsert:djiag:lands` NO toca
//   `spray_geom` a proposito, asi que hay que aplicarla aparte. Este backfill
//   formaliza el script temporal que se uso para reconstruir la DB.
//
// Que hace por land:
//   1. Lee `<externalId>_geometry.json` (via buildAssetPath del downloader).
//   2. Extrae el PlantZone (o el primer Polygon como fallback).
//   3. UPDATE dji_parcels
//        SET spray_geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(
//              ST_Force2D(ST_GeomFromGeoJSON(<geometry>))), 3)),
//            reference_point = ST_Centroid(spray_geom)
//      WHERE external_id = <externalId> AND source = <source>.
//   ST_Force2D quita la Z (DJI trae coords 3D); ST_MakeValid arregla las
//   auto-intersecciones (197 en la carga original); ST_CollectionExtract(,3)
//   garantiza que quede un (Multi)Polygon.
//
// SEGURIDAD: por defecto corre en DRY-RUN (read-only). Escribir requiere
// `--apply`.
//
// Uso:
//   node scripts/backfill-lands-geometry.js
//   node scripts/backfill-lands-geometry.js --limit 20
//   node scripts/backfill-lands-geometry.js --source dji
//   node scripts/backfill-lands-geometry.js --apply
//
// Env (.env.local): DATABASE_URL (o DATABASE_URL_DIRECT), DATABASE_SSL.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { buildAssetPath } = require("../lib/djiag-asset-downloader");

const DEFAULT_SOURCE = "dji";
const BATCH_SIZE = 100;

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

function createClient() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  if (!connectionString) throw new Error("DATABASE_URL (or DATABASE_URL_DIRECT) is not configured.");
  const useSsl = (process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  return new Client({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

function parseArgs(argv) {
  const args = {
    inPath: path.join(process.cwd(), "djiag_exports", "lands.json"),
    filesDir: path.join(process.cwd(), "djiag_exports", "land_files"),
    source: DEFAULT_SOURCE,
    apply: false,
    limit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--in" && argv[i + 1]) args.inPath = path.resolve(argv[++i]);
    else if (a === "--files-dir" && argv[i + 1]) args.filesDir = path.resolve(argv[++i]);
    else if (a === "--source" && argv[i + 1]) args.source = String(argv[++i]).trim();
    else if (a === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
  }
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) args.limit = null;
  if (!args.source) args.source = DEFAULT_SOURCE;
  return args;
}

/**
 * Extrae la geometria de fumigacion (PlantZone) de un geometry.json de DJI.
 * PURO y testeable. Acepta FeatureCollection, Feature o geometry cruda.
 * @returns {object|null} geometry GeoJSON (Polygon/MultiPolygon)
 */
function extractSprayGeojson(fc) {
  if (!fc || typeof fc !== "object") return null;
  if (fc.type === "FeatureCollection") {
    const features = Array.isArray(fc.features) ? fc.features : [];
    const plantZone = features.find((f) => f?.properties?.funcType === "PlantZone" && f.geometry);
    if (plantZone) return plantZone.geometry;
    const firstPoly = features.find(
      (f) => f?.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")
    );
    return firstPoly ? firstPoly.geometry : null;
  }
  if (fc.type === "Feature") return extractSprayGeojson(fc.geometry);
  if (fc.type === "Polygon" || fc.type === "MultiPolygon") return fc;
  return null;
}

/**
 * Deriva la lista de lands a procesar:
 *   - Si existe `lands.json`, usa sus `externalId`.
 *   - Si no, escanea `filesDir` por `*_geometry.json`.
 * @returns {Array<{ externalId: string, geometryPath: string, hasFile: boolean }>}
 */
function collectLands(args) {
  const out = [];
  const seen = new Set();
  const add = (externalId) => {
    const id = String(externalId ?? "").trim().toLowerCase();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const geometryPath = buildAssetPath(args.filesDir, id, "geometry");
    out.push({ externalId: id, geometryPath, hasFile: fs.existsSync(geometryPath) });
  };

  if (fs.existsSync(args.inPath)) {
    const data = JSON.parse(fs.readFileSync(args.inPath, "utf8"));
    const lands = Array.isArray(data) ? data : data.lands ?? [];
    for (const land of lands) add(land?.externalId);
  } else if (fs.existsSync(args.filesDir)) {
    for (const name of fs.readdirSync(args.filesDir)) {
      const m = name.match(/^(.*)_geometry\.json$/i);
      if (m) add(m[1]);
    }
  } else {
    throw new Error(
      `No existe ${args.inPath} ni ${args.filesDir}. Corré: npm run fetch:djiag:lands && npm run download:djiag:assets`
    );
  }

  return args.limit ? out.slice(0, args.limit) : out;
}

function readSprayGeojson(geometryPath) {
  const json = JSON.parse(fs.readFileSync(geometryPath, "utf8"));
  return extractSprayGeojson(json);
}

const UPDATE_SQL = `
  UPDATE public.dji_parcels p
     SET spray_geom = g.geom,
         reference_point = ST_Centroid(g.geom)
    FROM (
      SELECT ext AS external_id,
             ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Force2D(ST_GeomFromGeoJSON(geo))), 3)) AS geom
        FROM unnest($1::text[], $2::text[]) AS t(ext, geo)
    ) g
   WHERE p.external_id = g.external_id
     AND p.source = $3
`;

async function applyBatches(client, rows, source) {
  let updated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const ids = chunk.map((r) => r.externalId);
    const geoms = chunk.map((r) => JSON.stringify(r.geometry));
    const res = await client.query(UPDATE_SQL, [ids, geoms, source]);
    updated += res.rowCount;
    process.stdout.write(`\r  aplicando... ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} (${updated} filas)`);
  }
  process.stdout.write("\n");
  return updated;
}

async function countInvalid(client, source) {
  const res = await client.query(
    `SELECT COUNT(*)::int AS n FROM public.dji_parcels
      WHERE source = $1 AND spray_geom IS NOT NULL AND NOT ST_IsValid(spray_geom)`,
    [source]
  );
  return res.rows[0].n;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  const lands = collectLands(args);
  const withFile = lands.filter((l) => l.hasFile);
  const missing = lands.filter((l) => !l.hasFile);
  console.log(`[backfill-lands-geometry] lands: ${lands.length} · con geometry.json: ${withFile.length} · sin archivo: ${missing.length}`);
  console.log(`[backfill-lands-geometry] files-dir: ${path.relative(process.cwd(), args.filesDir)} · source: ${args.source}`);

  const parsed = [];
  let unparseable = 0;
  for (const l of withFile) {
    try {
      const geometry = readSprayGeojson(l.geometryPath);
      if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
        unparseable += 1;
        continue;
      }
      parsed.push({ externalId: l.externalId, geometry });
    } catch (err) {
      unparseable += 1;
      console.log(`  [warn] ${l.externalId}: ${err.message}`);
    }
  }
  console.log(`[backfill-lands-geometry] geometry parseada: ${parsed.length} · sin PlantZone/Polygon: ${unparseable}`);

  const client = createClient();
  try {
    await client.connect();

    // Chequeo read-only: cuantos lands de los parsed existen en dji_parcels.
    const ids = parsed.map((r) => r.externalId);
    let knownIds = new Set();
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const res = await client.query(
        `SELECT external_id FROM public.dji_parcels WHERE source = $1 AND external_id = ANY($2::text[])`,
        [args.source, chunk]
      );
      for (const row of res.rows) knownIds.add(row.external_id);
    }
    const resolvable = parsed.filter((r) => knownIds.has(r.externalId));
    const notInDb = parsed.length - resolvable.length;
    const invalidBefore = await countInvalid(client, args.source);
    console.log(`[backfill-lands-geometry] en dji_parcels(source=${args.source}): ${resolvable.length} · no estan en DB: ${notInDb}`);
    console.log(`[backfill-lands-geometry] spray_geom invalidas ANTES: ${invalidBefore}`);

    if (!args.apply) {
      console.log("");
      console.log("==================== DRY-RUN (no escribe) ====================");
      console.log(`  se actualizarian: ${resolvable.length} parcelas`);
      console.log(`  archivos faltantes: ${missing.length} (se skipean)`);
      console.log("===============================================================");
      console.log("Para escribir en la base: node scripts/backfill-lands-geometry.js --apply");
      return;
    }

    console.log("[backfill-lands-geometry] APPLY: aplicando geometria...");
    await client.query("SET statement_timeout = '15min'");
    const updated = await applyBatches(client, resolvable, args.source);
    const invalidAfter = await countInvalid(client, args.source);
    console.log(`[backfill-lands-geometry] filas actualizadas: ${updated}`);
    console.log(`[backfill-lands-geometry] spray_geom invalidas DESPUES: ${invalidAfter}`);
    console.log("[backfill-lands-geometry] DONE");
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backfill-lands-geometry] ERROR:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, extractSprayGeojson, collectLands, UPDATE_SQL };
