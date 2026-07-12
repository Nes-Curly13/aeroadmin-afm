// app/api/task-history/route.ts
//
// GET /api/task-history
//
// Vista Task History (Figma frame B — `AFM_SIG`).
// Combina dos datasets:
//   1. `days`  — rollup diario desde `dji_daily_summaries` (la tabla
//      materializada por scripts/aggregate-daily-summaries.mjs). Si el
//      caller pasa filtros de vuelo (parcelId/droneSerial/pilot) o si la
//      tabla no existe todavía (CI sin materializar), fallback a
//      agregación en runtime desde `dji_flights`.
//   2. `polygons` — polígonos fumigados con fechas por parcela (mapa).
//
// Query params (todos opcionales):
//   - from:         YYYY-MM-DD (default: hace 6 meses)
//   - to:           YYYY-MM-DD (default: hoy)
//   - parcelId:     number (filtra a una parcela)
//   - droneSerial:  string (filtra por serial de dron)
//   - pilot:        string (filtra por nombre de piloto)
//
// Source de datos (en orden de prioridad):
//   1. `dji_daily_summaries` — `summary_date, area_mu, times, liters,
//      duration_seconds, computed_at`. Tabla que mantiene
//      `scripts/aggregate-daily-summaries.mjs` (Sprint 2, 2026-06-28).
//   2. `dji_flights` — fallback cuando hay filtros de vuelo (la tabla
//      summary no tiene parcel_id/drone_serial/pilot_name) o cuando la
//      summary no existe (fresh CI run antes de materializar).
//   3. `dji_parcels` — para `spray_geom` del mapa.
//
// Cache:
//   No cacheamos. El caller (front) controla la frecuencia; los flights
//   cambian a cada import y no queremos esconder esos cambios.
//
// Auth:
//   No requiere auth (read-only sobre datos públicos del operador). Si en
//   el futuro hay tenants separados, se agrega `requireAuth` como en
//   `/api/parcels/[id]`.

import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import {
  aggregateNormalizedDays,
  buildTaskHistorySnapshot,
  type FlightLikeRow
} from "@/lib/djiag-from-make/task-history";
import { getPolygonsInRange } from "@/lib/djiag-spatial-aggregator";

export const dynamic = "force-dynamic";

/** Misma shape de DayCard que produce `buildTaskHistorySnapshot`. */
type DayCard = ReturnType<typeof buildTaskHistorySnapshot>["days"][number];
type Totals = ReturnType<typeof buildTaskHistorySnapshot>["totals"];
type Snapshot = ReturnType<typeof buildTaskHistorySnapshot>;

/** Item del array `polygons` (Figma frame B, columna #11). */
interface PolygonEntry {
  parcelId: number;
  landName: string | null;
  areaHa: number | null;
  datesFumigated: string[];
}

/** Default: ventana de 6 meses si el caller no pasa `from`/`to`. */
const DEFAULT_WINDOW_DAYS = 183; // ~6 meses

/** Constante de unidades (1 mu = 666.67 m²). */
const M2_PER_MU = 666.67;
const ML_PER_L = 1000;

/** Row cruda de dji_daily_summaries que devuelve pg.query. */
interface DailySummaryRow {
  summary_date: Date | string;
  area_mu: number | string;
  times: number;
  liters: number | string;
  duration_seconds: number;
}

/**
 * Parsea y valida una fecha YYYY-MM-DD. Devuelve null si es inválida o
 * si el string no matchea el formato estricto. Acepta string vacío como
 * null (significa "usar default").
 */
function parseIsoDate(
  value: string | null
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === null || value.trim() === "") {
    return { ok: true, value: "" }; // vacío = default
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: "Date must be YYYY-MM-DD." };
  }
  // Validar que sea una fecha real (no 2026-02-31)
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return { ok: false, error: "Invalid date (calendar mismatch)." };
  }
  return { ok: true, value };
}

/** Devuelve YYYY-MM-DD de "hoy" en UTC. La UI consume Bogota-local
 *  pero para la API usamos UTC midnight como referencia — los flights
 *  ya tienen su TZ manejada en `toLocalDateString`. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Devuelve YYYY-MM-DD de "hace N días" en UTC. */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → epoch seconds (UTC midnight). `createTimestamp` en
 *  NormalizedFumigationDay. Null si la fecha no matchea el formato. */
function dateStringToEpochSec(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = new Date(yyyyMmDd).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

/** Date | string → YYYY-MM-DD. `pg` devuelve `date` como `Date` JS. */
function toDateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return value;
}

/** Convierte una fila de `dji_daily_summaries` al shape
 *  `NormalizedFumigationDay` que espera `buildTaskHistorySnapshot`. */
function dailySummaryToNormalizedDay(row: DailySummaryRow): {
  createTimestamp: number | null;
  date: string | null;
  workAreaM2: number | null;
  workTimeSec: number | null;
  workTimeMin: number | null;
  sortieCount: number | null;
  sprayUsageMl: number | null;
  sprayUsageL: number | null;
  doseLPerHa: number | null;
  hasAgriculture: boolean;
} {
  const dateStr = toDateString(row.summary_date);
  const areaMu = Number(row.area_mu) || 0;
  const liters = Number(row.liters) || 0;
  const durationSec = Number(row.duration_seconds) || 0;
  const times = Number(row.times) || 0;
  const workAreaM2 = areaMu * M2_PER_MU;
  const sprayUsageMl = liters * ML_PER_L;

  return {
    createTimestamp: dateStr ? dateStringToEpochSec(dateStr) : null,
    date: dateStr,
    workAreaM2: Math.round(workAreaM2 * 100) / 100,
    workTimeSec: durationSec,
    workTimeMin: Math.round(durationSec / 60),
    sortieCount: times,
    sprayUsageMl,
    sprayUsageL: Math.round(liters * 100) / 100,
    // doseLPerHa = liters / areaHa. areaHa = areaMu * 0.0667. Si area=0
    // evitamos NaN devolviendo 0.
    doseLPerHa: areaMu > 0 ? Math.round((liters / (areaMu * 0.0667)) * 100) / 100 : 0,
    hasAgriculture: true
  };
}

/**
 * Lee los días del rango desde `dji_daily_summaries` (fast path).
 * Devuelve `null` si la tabla no existe (codes: '42P01' relation does not exist)
 * — el caller decide si fallback a `dji_flights`.
 */
async function fetchDaysFromSummary(
  from: string,
  to: string
): Promise<DailySummaryRow[] | null> {
  const db = getDb();
  try {
    const result = await db.query<DailySummaryRow>(
      `SELECT summary_date, area_mu, times, liters, duration_seconds
         FROM dji_daily_summaries
        WHERE summary_date >= $1::date
          AND summary_date <= $2::date
        ORDER BY summary_date DESC`,
      [from, to]
    );
    return result.rows;
  } catch (err) {
    if (isUndefinedTableError(err)) {
      return null;
    }
    throw err;
  }
}

/** Detecta el error "relation does not exist" de Postgres (SQLSTATE 42P01). */
function isUndefinedTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42P01") return true;
  // Fallback: algunos drivers envuelven el código pero el mensaje es estable
  if (typeof e.message === "string" && /relation .* does not exist/i.test(e.message)) {
    return true;
  }
  return false;
}

/** Lee los dji_flights que matchean los filtros, en formato FlightLikeRow. */
async function fetchFilteredFlights(args: {
  from: string;
  to: string;
  parcelId?: number;
  droneSerial?: string;
  pilot?: string;
}): Promise<FlightLikeRow[]> {
  const db = getDb();
  const where: string[] = [
    "start_at >= $1::date",
    "start_at <  ($2::date + INTERVAL '1 day')"
  ];
  const params: unknown[] = [args.from, args.to];
  if (args.parcelId !== undefined) {
    params.push(args.parcelId);
    where.push(`parcel_id = $${params.length}`);
  }
  if (args.droneSerial) {
    params.push(args.droneSerial);
    where.push(`drone_serial = $${params.length}`);
  }
  if (args.pilot) {
    params.push(args.pilot);
    where.push(`pilot_name = $${params.length}`);
  }
  const sql = `
    SELECT id, flight_id, start_at, duration_seconds, area_m2, spray_usage_ml
      FROM dji_flights
     WHERE ${where.join(" AND ")}
     ORDER BY start_at ASC
  `;
  const result = await db.query<{
    id: number;
    flight_id: number;
    start_at: Date;
    duration_seconds: number;
    area_m2: number | null;
    spray_usage_ml: number | null;
  }>(sql, params);
  return result.rows.map((r) => ({
    id: r.id,
    flight_id: r.flight_id,
    start_at: r.start_at,
    duration_seconds: r.duration_seconds ?? 0,
    area_m2: r.area_m2 ?? 0,
    spray_usage_ml: r.spray_usage_ml ?? 0
  }));
}

/**
 * Resuelve los días del rango con la estrategia:
 *   1. Si hay filtros de vuelo (parcelId/droneSerial/pilot), el summary
 *      no sirve (no tiene esas dimensiones) → re-agregar desde dji_flights.
 *   2. Si no hay filtros, intentar dji_daily_summaries.
 *   3. Si la tabla no existe (CI sin materializar) → fallback a dji_flights.
 */
async function resolveDays(args: {
  from: string;
  to: string;
  parcelId?: number;
  droneSerial?: string;
  pilot?: string;
}): Promise<ReturnType<typeof dailySummaryToNormalizedDay>[]> {
  const hasFlightFilters = args.parcelId !== undefined || !!args.droneSerial || !!args.pilot;

  // 1) Filtros de vuelo fuerzan el path por dji_flights
  if (hasFlightFilters) {
    const flights = await fetchFilteredFlights(args);
    return aggregateNormalizedDays(flights);
  }

  // 2) Fast path: dji_daily_summaries
  const summaryRows = await fetchDaysFromSummary(args.from, args.to);
  if (summaryRows !== null) {
    return summaryRows.map(dailySummaryToNormalizedDay);
  }

  // 3) Fallback: tabla no existe, agregamos desde dji_flights
  const flights = await fetchFilteredFlights(args);
  return aggregateNormalizedDays(flights);
}

/**
 * GET /api/task-history?from=2026-01-01&to=2026-07-12&parcelId=42&droneSerial=R12&pilot=breiner
 *
 * 200: { totals, days, polygons, dateRange: { from, to } }
 * 400: { error } si las fechas son inválidas o parcelId no es entero
 * 500: { error } si la BD falla
 */
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;

    // ---- Parse + validate query params ----
    const fromParsed = parseIsoDate(url.searchParams.get("from"));
    if (!fromParsed.ok) {
      return NextResponse.json({ error: `from: ${fromParsed.error}` }, { status: 400 });
    }
    const toParsed = parseIsoDate(url.searchParams.get("to"));
    if (!toParsed.ok) {
      return NextResponse.json({ error: `to: ${toParsed.error}` }, { status: 400 });
    }

    const to = toParsed.value || todayIso();
    const from = fromParsed.value || daysAgoIso(DEFAULT_WINDOW_DAYS);
    if (from > to) {
      return NextResponse.json(
        { error: "from must be <= to." },
        { status: 400 }
      );
    }

    const rawParcelId = url.searchParams.get("parcelId");
    let parcelId: number | undefined;
    if (rawParcelId !== null && rawParcelId !== "") {
      if (!/^\d+$/.test(rawParcelId)) {
        return NextResponse.json(
          { error: "parcelId must be a positive integer." },
          { status: 400 }
        );
      }
      parcelId = Number(rawParcelId);
    }

    const droneSerial = url.searchParams.get("droneSerial")?.trim() || undefined;
    const pilot = url.searchParams.get("pilot")?.trim() || undefined;

    // ---- Fetch + aggregate days ----
    const normalizedDays = await resolveDays({ from, to, parcelId, droneSerial, pilot });
    const snapshot: Snapshot = buildTaskHistorySnapshot(normalizedDays, { from, to });

    // ---- Fetch polygons para el mapa ----
    // Modo default `onlyFumigated: true` — la UI del Task History muestra
    // los polígonos fumigados en el rango, no todos los 1207. Si el caller
    // quiere "ver todos los campos aunque no fumigaron", lo agregamos como
    // query param `allParcels=1` más adelante (decisión 5 sigue abierta).
    const polygonsRaw = await getPolygonsInRange({
      from,
      to,
      onlyFumigated: true,
      parcelId,
      droneSerial,
      pilot
    });
    const polygons: PolygonEntry[] = polygonsRaw.map((p) => ({
      parcelId: p.parcelId,
      landName: p.landName,
      areaHa: p.areaHa,
      datesFumigated: p.datesFumigated
    }));

    return NextResponse.json({
      totals: snapshot.totals,
      days: snapshot.days,
      polygons,
      dateRange: snapshot.dateRange
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch task history.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// (helpers re-exported para tests que importen tipos desde la ruta)
export type { DayCard, Totals, Snapshot };
