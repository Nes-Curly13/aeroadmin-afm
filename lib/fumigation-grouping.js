// lib/fumigation-grouping.js
//
// Logica pura (sin DB) para agrupar vuelos (`dji_flights`) en fumigaciones.
//
// Decision de producto (handoff 2026-09-20, §3; ajustada 2026-09-20b):
//   Una fumigacion = parcela + dia + mision. Vuelos consecutivos de la
//   misma parcela/dia se consideran la MISMA mision mientras el hueco
//   (idle gap) entre el fin de un vuelo y el inicio del siguiente no
//   supere **30 minutos**. Si supera, es una fumigacion DISTINTA
//   (separa pasadas/tandas). Los vuelos sin parcela (huerfanos) se
//   agrupan igual, pero con `parcelId = null` y `orphan = true`.
//
// Por que este modulo vive en JS (y no TS):
//   Lo consumen los scripts CLI (`scripts/import-fumigations-from-flights.js`)
//   que corren con `node` puro (CommonJS), sin transpilar TS. Los tests
//   (Vitest) lo importan via `@/lib/fumigation-grouping`.

const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutos
const DEFAULT_ORPHAN_MAX_DISTANCE_M = 1000; // salto espacial que separa sesiones huerfanas
const BOGOTA_TZ = "America/Bogota";

/**
 * Fecha local (America/Bogota) en formato YYYY-MM-DD para un epoch ms.
 * TZ fija (no depende de la TZ de la maquina) para que el agrupamiento
 * sea reproducible en CI y en prod.
 *
 * @param {number} epochMs
 * @returns {string}
 */
function toBogotaDate(epochMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Moda determinista de un array de strings/null.
 * - Ignora null/undefined/vacio.
 * - Empate: gana el valor lexicograficamente menor (estable/testeable).
 * - Array vacio / todos nulos: devuelve null.
 *
 * @param {Array<string|null|undefined>} values
 * @returns {string|null}
 */
function modeOf(values) {
  const counts = new Map();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s.length === 0) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Clave determinista de una sesion de fumigacion.
 *
 * @param {{ parcelId: number|null, date: string, startAtMs: number }} input
 * @returns {string}
 */
function sessionKeyFor({ parcelId, date, startAtMs }) {
  const parcelKey = parcelId === null || parcelId === undefined ? "orphan" : String(parcelId);
  return `${parcelKey}|${date}|${startAtMs}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Distancia aproximada (Haversine, metros) entre dos puntos WGS84.
 * @returns {number|null} null si falta algun componente.
 */
function haversineMeters(aLng, aLat, bLng, bLat) {
  if ([aLng, aLat, bLng, bLat].some((v) => v === null || v === undefined || !Number.isFinite(Number(v)))) {
    return null;
  }
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(bLat) - toRad(aLat);
  const dLng = toRad(bLng) - toRad(aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Agrupa vuelos ya "matcheados" a parcela en fumigaciones.
 *
 * @param {Array<{
 *   flightId: number,
 *   parcelId: number|null,
 *   startAtMs: number,
 *   endAtMs?: number|null,
 *   durationSeconds?: number,
 *   areaM2?: number,
 *   sprayUsageMl?: number,
 *   droneNickname?: string|null,
 *   pilotName?: string|null,
 *   lng?: number|null,
 *   lat?: number|null,
 * }>} flights
 * @param {{ gapMs?: number, maxDistanceM?: number }} [opts]
 *   gapMs: hueco temporal (idle) que separa misiones (default 30 min).
 *   maxDistanceM: salto espacial que separa sesiones HUERFANAS (default
 *     1000 m). Solo aplica a huerfanas; las que tienen parcela ya estan
 *     delimitadas por la parcela.
 * @returns {Array<{
 *   parcelId: number|null,
 *   date: string,
 *   sessionKey: string,
 *   orphan: boolean,
 *   startAtMs: number,
 *   endAtMs: number,
 *   flightsCount: number,
 *   flightIds: number[],
 *   areaM2: number,
 *   sprayUsageMl: number,
 *   durationSeconds: number,
 *   droneNickname: string|null,
 *   pilotName: string|null,
 *   centroidLng: number|null,
 *   centroidLat: number|null,
 * }>}
 */
function groupFumigationFlights(flights, opts = {}) {
  const gapMs = Number.isFinite(opts.gapMs) && opts.gapMs > 0 ? opts.gapMs : DEFAULT_SESSION_GAP_MS;
  const maxDistanceM =
    Number.isFinite(opts.maxDistanceM) && opts.maxDistanceM > 0
      ? opts.maxDistanceM
      : DEFAULT_ORPHAN_MAX_DISTANCE_M;

  const buckets = new Map(); // `${parcelKey}|${date}` -> candidate[]
  for (const f of flights) {
    if (!f || f.startAtMs === null || f.startAtMs === undefined || !Number.isFinite(Number(f.startAtMs))) {
      continue;
    }
    const parcelId = f.parcelId === null || f.parcelId === undefined ? null : Number(f.parcelId);
    const startAtMs = Number(f.startAtMs);
    const date = toBogotaDate(startAtMs);
    const bucketKey = `${parcelId === null ? "orphan" : parcelId}|${date}`;
    const list = buckets.get(bucketKey) ?? [];
    const hasEnd =
      f.endAtMs !== null &&
      f.endAtMs !== undefined &&
      f.endAtMs !== "" &&
      Number.isFinite(Number(f.endAtMs));
    list.push({
      parcelId,
      date,
      flightId: Number(f.flightId),
      startAtMs,
      endAtMs: hasEnd ? Number(f.endAtMs) : startAtMs + num(f.durationSeconds) * 1000,
      areaM2: num(f.areaM2),
      sprayUsageMl: num(f.sprayUsageMl),
      durationSeconds: num(f.durationSeconds),
      droneNickname: f.droneNickname ?? null,
      pilotName: f.pilotName ?? null,
      lng: numOrNull(f.lng),
      lat: numOrNull(f.lat),
    });
    buckets.set(bucketKey, list);
  }

  const groups = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.startAtMs - b.startAtMs);

    let current = null;
    let prevEndMs = null;
    for (const f of list) {
      const timeGapExceeded = current !== null && prevEndMs !== null && f.startAtMs - prevEndMs > gapMs;
      // Las huerfanas tambien se separan si el vuelo salta lejos del
      // ultimo de la sesion (distinto lote/finca).
      const spatialJump =
        current !== null &&
        current.orphan &&
        current._lastLng !== null &&
        current._lastLat !== null
          ? (haversineMeters(current._lastLng, current._lastLat, f.lng, f.lat) ?? 0) > maxDistanceM
          : false;
      if (current === null || timeGapExceeded || spatialJump) {
        current = {
          parcelId: f.parcelId,
          date: f.date,
          sessionKey: sessionKeyFor({ parcelId: f.parcelId, date: f.date, startAtMs: f.startAtMs }),
          orphan: f.parcelId === null,
          startAtMs: f.startAtMs,
          endAtMs: f.endAtMs,
          flightsCount: 0,
          flightIds: [],
          areaM2: 0,
          sprayUsageMl: 0,
          durationSeconds: 0,
          _drones: [],
          _pilots: [],
          _lastLng: f.lng,
          _lastLat: f.lat,
          _sumLng: 0,
          _sumLat: 0,
          _nCoords: 0,
        };
        groups.push(current);
      }
      current.flightsCount += 1;
      current.flightIds.push(f.flightId);
      current.areaM2 += f.areaM2;
      current.sprayUsageMl += f.sprayUsageMl;
      current.durationSeconds += f.durationSeconds;
      current.endAtMs = Math.max(current.endAtMs, f.endAtMs);
      current._drones.push(f.droneNickname);
      current._pilots.push(f.pilotName);
      if (f.lng !== null && f.lat !== null) {
        current._lastLng = f.lng;
        current._lastLat = f.lat;
        current._sumLng += f.lng;
        current._sumLat += f.lat;
        current._nCoords += 1;
      }
      prevEndMs = f.endAtMs;
    }
  }

  for (const g of groups) {
    g.droneNickname = modeOf(g._drones);
    g.pilotName = modeOf(g._pilots);
    g.areaM2 = Math.round(g.areaM2);
    g.sprayUsageMl = Math.round(g.sprayUsageMl);
    g.centroidLng = g._nCoords > 0 ? g._sumLng / g._nCoords : null;
    g.centroidLat = g._nCoords > 0 ? g._sumLat / g._nCoords : null;
    delete g._drones;
    delete g._pilots;
    delete g._lastLng;
    delete g._lastLat;
    delete g._sumLng;
    delete g._sumLat;
    delete g._nCoords;
  }

  groups.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startAtMs !== b.startAtMs) return a.startAtMs - b.startAtMs;
    const ap = a.parcelId === null ? Number.MAX_SAFE_INTEGER : a.parcelId;
    const bp = b.parcelId === null ? Number.MAX_SAFE_INTEGER : b.parcelId;
    return ap - bp;
  });

  return groups;
}

module.exports = {
  DEFAULT_SESSION_GAP_MS,
  DEFAULT_ORPHAN_MAX_DISTANCE_M,
  BOGOTA_TZ,
  toBogotaDate,
  modeOf,
  sessionKeyFor,
  haversineMeters,
  groupFumigationFlights,
};
