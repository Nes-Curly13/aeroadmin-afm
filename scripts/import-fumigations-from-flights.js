#!/usr/bin/env node
// scripts/import-fumigations-from-flights.js
//
// Importa el log per-flight de DJI (`djiag_exports/perflight_records.json`,
// ~10.475 vuelos) y DERIVA las fumigaciones agrupando por
// parcela + dia + sesion (gap > 1 h). Ver handoff 2026-09-20 §3.
//
// Flujo:
//   1. Parsea el JSON (lib/djiag-flights-fetcher).
//   2. Matchea cada vuelo a una parcela via ST_Within / ST_DWithin (50 m)
//      — query READ-ONLY (no escribe nada).
//   3. Filtra vuelos "de fumigacion" (usage_type=0 y spray_usage>0).
//   4. Agrupa con lib/fumigation-grouping (sesion = idle gap > 1 h).
//   5. Reporta. Solo con `--apply` escribe:
//        - UPSERT de los vuelos en dji_flights (idempotente por flight_id).
//        - UPSERT de las fumigaciones en dji_fumigations (idempotente por
//          session_key), con huérfanas marcadas.
//        - REFRESH de las MVs (salvo --no-refresh).
//
// SEGURIDAD: por defecto corre en DRY-RUN. Escribir requiere `--apply`.
// El dry-run NO toca la base: el matching es un SELECT.
//
// Uso:
//   node scripts/import-fumigations-from-flights.js
//   node scripts/import-fumigations-from-flights.js --limit 500
//   node scripts/import-fumigations-from-flights.js --tolerance 50 --gap-minutes 60
//   node scripts/import-fumigations-from-flights.js --apply
//
// Env (.env.local): DATABASE_URL (o DATABASE_URL_DIRECT), DATABASE_SSL.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { parsePerFlightFile, UPSERT_SQL, paramsToPgArray } = require("../lib/djiag-flights-fetcher");
const { groupFumigationFlights } = require("../lib/fumigation-grouping");

const ML_PER_L = 1000;
const M2_PER_HA = 10000;

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
  const args = {
    inPath: path.join(process.cwd(), "djiag_exports", "perflight_records.json"),
    apply: false,
    refresh: true,
    tolerance: 50,
    gapMinutes: 60,
    maxOrphanDistanceM: 1000,
    orphanSpatialSplit: true,
    limit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--no-refresh") args.refresh = false;
    else if (a === "--no-orphan-spatial-split") args.orphanSpatialSplit = false;
    else if (a === "--in" && argv[i + 1]) args.inPath = path.resolve(argv[++i]);
    else if (a === "--tolerance" && argv[i + 1]) args.tolerance = Number(argv[++i]);
    else if (a === "--gap-minutes" && argv[i + 1]) args.gapMinutes = Number(argv[++i]);
    else if (a === "--max-orphan-distance-m" && argv[i + 1]) args.maxOrphanDistanceM = Number(argv[++i]);
    else if (a === "--limit" && argv[i + 1]) args.limit = Number(argv[++i]);
  }
  if (!Number.isFinite(args.tolerance) || args.tolerance < 0) args.tolerance = 50;
  if (!Number.isFinite(args.gapMinutes) || args.gapMinutes <= 0) args.gapMinutes = 60;
  if (!Number.isFinite(args.maxOrphanDistanceM) || args.maxOrphanDistanceM <= 0) args.maxOrphanDistanceM = 1000;
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit <= 0)) args.limit = null;
  return args;
}

function effectiveOrphanDistance(args) {
  // Sin split espacial: cualquier distancia entra en la misma sesion. Usamos
  // un valor finito enorme para no tocar la validacion del modulo puro.
  return args.orphanSpatialSplit ? args.maxOrphanDistanceM : 1e12;
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

function isFumigationFlight(raw) {
  if (!raw) return false;
  if (Number(raw.usage_type) !== 0) return false;
  return Number(raw.spray_usage || 0) > 0;
}

function fmtHa(m2) {
  return (Number(m2) / M2_PER_HA).toFixed(2);
}

function fmtL(ml) {
  return (Number(ml) / ML_PER_L).toFixed(1);
}

/**
 * Matchea vuelos a parcelas (READ-ONLY).
 * @returns {Promise<Map<number, { parcelId: number|null, landName: string|null, externalId: string|null, distanceM: number|null }>>}
 */
async function matchFlightsToParcels(client, flights, toleranceMeters) {
  const withCoords = flights.filter(
    (f) => f.flightId && f.lng !== null && f.lng !== undefined && f.lat !== null && f.lat !== undefined
  );
  const map = new Map();
  if (withCoords.length === 0) return map;

  // Tolerancia en grados (1 grado ~ 111.32 km). Usamos distancia en
  // GEOMETRIA (no geography) para que ST_DWithin pueda usar el indice GIST
  // de spray_geom; el cast a geography forzaba un seq scan por punto y
  // reventaba el statement_timeout. La distancia final (m) si usa geography,
  // solo para el candidato ya elegido.
  const toleranceDeg = Number(toleranceMeters) / 111320;

  const sql = `
    WITH input AS (
      SELECT * FROM unnest($1::bigint[], $2::float8[], $3::float8[])
        AS t(flight_id, lng, lat)
    )
    SELECT
      i.flight_id,
      p.id AS parcel_id,
      p.land_name,
      p.external_id,
      CASE
        WHEN p.id IS NULL THEN NULL
        ELSE ST_Distance(
          ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)::geography,
          p.spray_geom::geography
        )
      END AS distance_m
    FROM input i
    LEFT JOIN LATERAL (
      SELECT id, land_name, external_id, spray_geom
      FROM dji_parcels
      WHERE deleted_at IS NULL
        AND spray_geom IS NOT NULL
        AND (
          ST_Within(ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326), spray_geom)
          OR ST_DWithin(
            ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326),
            spray_geom,
            $4::float8
          )
        )
      ORDER BY
        CASE WHEN ST_Within(ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326), spray_geom)
             THEN 0 ELSE 1 END,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326),
          spray_geom
        )
      LIMIT 1
    ) p ON true
  `;

  const BATCH = 1000;
  for (let start = 0; start < withCoords.length; start += BATCH) {
    const chunk = withCoords.slice(start, start + BATCH);
    const ids = chunk.map((f) => Number(f.flightId));
    const lngs = chunk.map((f) => Number(f.lng));
    const lats = chunk.map((f) => Number(f.lat));
    const res = await client.query(sql, [ids, lngs, lats, toleranceDeg]);
    for (const row of res.rows) {
      map.set(Number(row.flight_id), {
        parcelId: row.parcel_id === null ? null : Number(row.parcel_id),
        landName: row.land_name ?? null,
        externalId: row.external_id ?? null,
        distanceM: row.distance_m === null ? null : Number(row.distance_m),
      });
    }
    process.stdout.write(`\r  matching... ${Math.min(start + BATCH, withCoords.length)}/${withCoords.length}`);
  }
  process.stdout.write("\n");
  return map;
}

function buildCandidates(parsedFlights, rawFlights, matchMap) {
  const eligible = [];
  for (let i = 0; i < parsedFlights.length; i++) {
    const raw = rawFlights[i];
    if (!isFumigationFlight(raw)) continue;
    const f = parsedFlights[i];
    if (!f.flightId) continue;
    const startAtMs = f.startAt ? f.startAt.getTime() : null;
    if (startAtMs === null || !Number.isFinite(startAtMs)) continue;
    const m = matchMap.get(Number(f.flightId));
    eligible.push({
      flightId: Number(f.flightId),
      parcelId: m ? m.parcelId : null,
      startAtMs,
      endAtMs: f.endAt ? f.endAt.getTime() : null,
      durationSeconds: f.durationSeconds,
      areaM2: f.areaM2,
      sprayUsageMl: f.sprayUsageMl,
      droneNickname: f.droneNickname,
      pilotName: f.pilotName,
      lng: f.lng,
      lat: f.lat,
      raw,
    });
  }
  return eligible;
}

function printDryRunReport({ args, totalFlights, eligible, groups, matchMap, parcelById }) {
  const groupsWithParcel = groups.filter((g) => !g.orphan);
  const orphanGroups = groups.filter((g) => g.orphan);
  const totalFlightsInGroups = groups.reduce((s, g) => s + g.flightsCount, 0);

  const matchedEligible = eligible.filter((e) => e.parcelId !== null).length;
  const orphanFlights = eligible.length - matchedEligible;

  const sessionsByParcelDay = new Map();
  for (const g of groupsWithParcel) {
    const key = `${g.parcelId}|${g.date}`;
    sessionsByParcelDay.set(key, (sessionsByParcelDay.get(key) ?? 0) + 1);
  }
  const multiSession = [...sessionsByParcelDay.values()].filter((n) => n > 1).length;

  const totalAreaM2 = groups.reduce((s, g) => s + g.areaM2, 0);
  const totalSprayMl = groups.reduce((s, g) => s + g.sprayUsageMl, 0);

  console.log("");
  console.log("==================== DRY-RUN (no escribe) ====================");
  console.log(`  archivo:                 ${path.relative(process.cwd(), args.inPath)}`);
  console.log(`  limite:                  ${args.limit ?? "(todos)"}`);
  console.log(`  tolerancia match:        ${args.tolerance} m`);
  console.log(`  gap de sesion:           ${args.gapMinutes} min`);
  console.log(`  salto huerfanas:         ${args.orphanSpatialSplit ? `${args.maxOrphanDistanceM} m` : "desactivado (solo tiempo)"}`);
  console.log("");
  console.log(`  vuelos en el archivo:    ${totalFlights}`);
  console.log(`  vuelos de fumigacion:    ${eligible.length}`);
  console.log(`  vuelos con coords:       ${matchMap.size}`);
  console.log(`  vuelos matcheados:       ${matchedEligible}`);
  console.log(`  vuelos huerfanos:        ${orphanFlights}`);
  console.log("");
  console.log(`  fumigaciones (grupos):   ${groups.length}`);
  console.log(`    con parcela:           ${groupsWithParcel.length}`);
  console.log(`    huerfanas:             ${orphanGroups.length}`);
  console.log(`  parcela+dia multi-sesion:${multiSession}`);
  console.log(`  vuelos representados:    ${totalFlightsInGroups}`);
  console.log(`  area total:              ${fmtHa(totalAreaM2)} ha`);
  console.log(`  volumen total:           ${fmtL(totalSprayMl)} L`);

  console.log("");
  console.log("  --- muestra: fumigaciones CON parcela ---");
  for (const g of groupsWithParcel.slice(0, 5)) {
    console.log(
      `    #${g.parcelId} ${(parcelById.get(g.parcelId)?.landName ?? "?").slice(0, 34).padEnd(34)} ` +
        `${g.date}  vuelos=${String(g.flightsCount).padStart(2)}  ` +
        `area=${fmtHa(g.areaM2)} ha  vol=${fmtL(g.sprayUsageMl)} L  dron=${g.droneNickname ?? "-"}`
    );
  }
  console.log("");
  console.log(`  --- muestra: HUERFANAS (${orphanGroups.length}) ---`);
  for (const g of orphanGroups.slice(0, 5)) {
    console.log(
      `    ${g.date}  vuelos=${String(g.flightsCount).padStart(2)}  ` +
        `area=${fmtHa(g.areaM2)} ha  vol=${fmtL(g.sprayUsageMl)} L  dron=${g.droneNickname ?? "-"}`
    );
  }
  console.log("===============================================================");
  console.log("");
  console.log("Para escribir en la base (requiere haberte aprobado el dry-run):");
  console.log("  node scripts/import-fumigations-from-flights.js --apply");
  console.log("");
}

async function applyImport({ client, parsedFlights, groups, matchMap }) {
  await client.query("BEGIN");

  // 1) UPSERT de TODOS los vuelos (log completo), con parcel_id matcheado.
  let flightsUpserted = 0;
  for (const f of parsedFlights) {
    if (!f.flightId || (!f.startAt && !f.endAt)) continue;
    const m = matchMap.get(Number(f.flightId));
    f.parcelId = m ? m.parcelId : null;
    await client.query(UPSERT_SQL, paramsToPgArray(f));
    flightsUpserted += 1;
  }

  // 2) UPSERT de las fumigaciones por session_key.
  const insertSql = `
    INSERT INTO dji_fumigations (
      parcel_id, fumigation_date, area_fumigated_m2, duration_minutes,
      notes, recorded_by, source, flight_ids, parcels,
      needs_parcel_assignment, assignment_note, session_key
    ) VALUES (
      $1, $2, $3, $4,
      $5::jsonb, $6, 'import', $7::int[], $8::text[],
      $9, $10, $11
    )
    ON CONFLICT (session_key) WHERE session_key IS NOT NULL DO UPDATE SET
      parcel_id                = EXCLUDED.parcel_id,
      fumigation_date          = EXCLUDED.fumigation_date,
      area_fumigated_m2        = EXCLUDED.area_fumigated_m2,
      duration_minutes         = EXCLUDED.duration_minutes,
      notes                    = EXCLUDED.notes,
      recorded_by              = EXCLUDED.recorded_by,
      source                   = EXCLUDED.source,
      flight_ids               = EXCLUDED.flight_ids,
      parcels                  = EXCLUDED.parcels,
      needs_parcel_assignment  = EXCLUDED.needs_parcel_assignment,
      assignment_note          = EXCLUDED.assignment_note
    RETURNING id
  `;

  let fumigationsUpserted = 0;
  for (const g of groups) {
    const notes = {
      import: "perflight-session",
      session_key: g.sessionKey,
      flights_count: g.flightsCount,
      drone: g.droneNickname,
      pilot: g.pilotName,
      first_start_iso: new Date(g.startAtMs).toISOString(),
      last_end_iso: new Date(g.endAtMs).toISOString(),
      centroid_lng: g.centroidLng,
      centroid_lat: g.centroidLat,
      orphan: g.orphan,
    };
    const assignmentNote = g.orphan
      ? `${g.flightsCount} vuelo(s) sin parcela (${g.date}). Centroide: ${
          g.centroidLat !== null && g.centroidLng !== null
            ? `${g.centroidLat.toFixed(6)}, ${g.centroidLng.toFixed(6)}`
            : "sin coords"
        }. Asignar a una parcela existente o crear una nueva (hull de los vuelos).`
      : null;
    await client.query(insertSql, [
      g.parcelId,
      g.date,
      g.areaM2,
      Math.round(g.durationSeconds / 60),
      JSON.stringify(notes),
      "djiag-import",
      g.flightIds,
      [],
      g.orphan,
      assignmentNote,
      g.sessionKey,
    ]);
    fumigationsUpserted += 1;
  }

  await client.query("COMMIT");
  return { flightsUpserted, fumigationsUpserted };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.inPath)) {
    throw new Error(`No existe ${args.inPath}.`);
  }

  console.log(`[import-fumigations] leyendo ${path.relative(process.cwd(), args.inPath)}...`);
  const rawFile = JSON.parse(fs.readFileSync(args.inPath, "utf8"));
  const parsed = parsePerFlightFile(rawFile);
  let parsedFlights = parsed.flights;
  let rawFlights = rawFile.flights;
  if (args.limit !== null) {
    parsedFlights = parsedFlights.slice(0, args.limit);
    rawFlights = rawFlights.slice(0, args.limit);
  }
  console.log(`  vuelos parseados: ${parsedFlights.length}`);

  const client = createClient();
  try {
    await client.connect();

    console.log(`[import-fumigations] matching vuelos -> parcelas (read-only, tol=${args.tolerance}m)...`);
    const matchMap = await matchFlightsToParcels(client, parsedFlights, args.tolerance);
    console.log(`  matcheados: ${[...matchMap.values()].filter((m) => m.parcelId !== null).length}`);

    const eligible = buildCandidates(parsedFlights, rawFlights, matchMap);
    const groups = groupFumigationFlights(eligible, {
      gapMs: args.gapMinutes * 60 * 1000,
      maxDistanceM: effectiveOrphanDistance(args),
    });

    const parcelById = new Map();
    for (const m of matchMap.values()) {
      if (m.parcelId !== null) parcelById.set(m.parcelId, m);
    }

    if (!args.apply) {
      printDryRunReport({ args, totalFlights: parsedFlights.length, eligible, groups, matchMap, parcelById });
      return;
    }

    console.log("[import-fumigations] APPLY: escribiendo en la base...");
    const stats = await applyImport({
      client,
      parsedFlights,
      groups,
      matchMap,
    });
    console.log(`  dji_flights upsert:      ${stats.flightsUpserted}`);
    console.log(`  dji_fumigations upsert:  ${stats.fumigationsUpserted}`);

    if (args.refresh) {
      console.log("[import-fumigations] refrescando materialized views...");
      const { main: refreshMain } = require("./refresh-fumigations");
      await refreshMain();
    }
    console.log("[import-fumigations] DONE");
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[import-fumigations] ERROR:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { main, matchFlightsToParcels, isFumigationFlight, parseArgs };
