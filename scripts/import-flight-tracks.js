#!/usr/bin/env node
// scripts/import-flight-tracks.js
//
// Ingesta los TRACKS (LineString) de los vuelos del scraper DJI y los
// guarda en `dji_flight_tracks` + `dji_flights.track`. Con eso se calcula
// la cobertura real de cada fumigacion (ver recompute-fumigation-coverage.js).
//
// Entradas soportadas:
//   - Un `.geojson` (FeatureCollection de LineStrings; id del vuelo en
//     properties.flight_id | id | Id | FLIGHT_ID, o feature.id).
//   - Una carpeta con `*.geojson` o `*.kml` (id del vuelo = nombre del
//     archivo sin extension, o properties).
//   - Un `.kml` (se parsea con @tmcw/togeojson).
//
// SEGURIDAD: dry-run por defecto. Escribir requiere `--apply`.
//
// Uso:
//   node scripts/import-flight-tracks.js --in djiag_exports/tracks.geojson
//   node scripts/import-flight-tracks.js --in djiag_exports/geojson --apply
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
  const a = { inPath: null, apply: false, idProp: null, limit: null, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in" && argv[i + 1]) a.inPath = argv[++i];
    else if (argv[i] === "--apply") a.apply = true;
    else if (argv[i] === "--id-prop" && argv[i + 1]) a.idProp = argv[++i];
    else if (argv[i] === "--limit" && argv[i + 1]) a.limit = Number(argv[++i]);
    else if (argv[i] === "--batch" && argv[i + 1]) a.batch = Number(argv[++i]);
  }
  return a;
}

const ID_KEYS = ["flight_id", "flightId", "flightid", "id", "ID", "Id", "FLIGHT_ID", "dj_flight_id"];

function extractId(props, fallback) {
  if (props) {
    for (const k of ID_KEYS) if (props[k] != null && props[k] !== "") return Number(props[k]);
  }
  const n = Number(String(fallback ?? "").replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isLine(g) {
  return g && (g.type === "LineString" || g.type === "MultiLineString");
}

async function parseKml(text) {
  const { DOMParser } = require("@xmldom/xmldom");
  const { kml } = await import("@tmcw/togeojson");
  const doc = new DOMParser().parseFromString(text, "text/xml");
  return kml(doc);
}

async function collectFromFile(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext);
  let fc;
  if (ext === ".geojson" || ext === ".json") {
    fc = JSON.parse(fs.readFileSync(file, "utf8"));
  } else if (ext === ".kml") {
    fc = await parseKml(fs.readFileSync(file, "utf8"));
  } else {
    return [];
  }
  const features = fc.type === "FeatureCollection" ? fc.features : fc.type === "Feature" ? [fc] : [];
  const out = [];
  for (const f of features) {
    if (!isLine(f.geometry)) continue;
    const id = extractId(f.properties, f.id ?? base);
    if (!id) continue;
    out.push({ flightId: id, geometry: f.geometry, file: path.basename(file) });
  }
  return out;
}

async function collect(input) {
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(input)
      .filter((f) => /\.(geojson|json|kml)$/i.test(f))
      .map((f) => path.join(input, f));
    const out = [];
    for (const f of files) out.push(...(await collectFromFile(f)));
    return { tracks: out, files: files.length };
  }
  return { tracks: await collectFromFile(input), files: 1 };
}

async function applyTracks(client, tracks, batchSize) {
  let upserted = 0;
  for (let i = 0; i < tracks.length; i += batchSize) {
    const chunk = tracks.slice(i, i + batchSize);
    const ids = chunk.map((t) => t.flightId);
    const geoms = chunk.map((t) => JSON.stringify(t.geometry));
    await client.query(
      `INSERT INTO dji_flight_tracks (flight_id, geom)
       SELECT a.fid,
              CASE WHEN ST_GeometryType(g) = 'ST_LineString' THEN g
                   ELSE ST_GeometryN(g, 1) END
         FROM unnest($1::bigint[]) WITH ORDINALITY AS a(fid, ord)
         JOIN unnest($2::text[]) WITH ORDINALITY AS b(gj, ord) USING (ord)
         CROSS JOIN LATERAL (SELECT ST_Force2D(ST_GeomFromGeoJSON(b.gj)) AS g) s
       ON CONFLICT (flight_id) DO UPDATE SET geom = EXCLUDED.geom, updated_at = now()`,
      [ids, geoms]
    );
    upserted += chunk.length;
    if (upserted % 2000 === 0) console.log(`  tracks upsert: ${upserted}`);
  }
  // Propagar a dji_flights.track (un solo UPDATE por join).
  const upd = await client.query(
    `UPDATE dji_flights f
        SET track = t.geom
       FROM dji_flight_tracks t
      WHERE f.flight_id = t.flight_id
        AND f.track IS DISTINCT FROM t.geom`
  );
  return { upserted, flightsUpdated: upd.rowCount ?? 0 };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.inPath) throw new Error("Falta --in <ruta .geojson|.kml|carpeta>");
  const input = path.resolve(args.inPath);
  if (!fs.existsSync(input)) throw new Error(`No existe ${input}`);

  const { tracks, files } = await collect(input);
  const limited = args.limit ? tracks.slice(0, args.limit) : tracks;
  console.log(`[tracks] ${files} archivo(s) · ${limited.length} LineStrings${args.limit ? ` (limit ${args.limit})` : ""}`);

  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT,
    ssl: (process.env.DATABASE_SSL || "false") === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  await client.query("SET statement_timeout = '15min'");
  try {
    const ids = limited.map((t) => t.flightId);
    const known = await client.query(
      `SELECT count(*)::int AS n FROM dji_flights WHERE flight_id = ANY($1::bigint[])`,
      [ids]
    );
    console.log(`  flight_ids presentes en dji_flights: ${known.rows[0].n}/${ids.length}`);

    if (!args.apply) {
      console.log("[tracks] DRY-RUN (no escribe). Ejemplo ids:", ids.slice(0, 5));
      console.log("[tracks] para escribir: --apply");
      return;
    }
    const stats = await applyTracks(client, limited, args.batch);
    console.log(`[tracks] OK: ${stats.upserted} tracks upsert, ${stats.flightsUpdated} dji_flights.track actualizados`);
    console.log("[tracks] ahora corré: node scripts/recompute-fumigation-coverage.js --apply");
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[tracks] ERROR:", e && e.message ? e.message : e);
    process.exit(1);
  });
}

module.exports = { main, collect, extractId };
