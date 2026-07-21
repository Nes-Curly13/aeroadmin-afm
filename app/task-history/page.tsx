// app/task-history/page.tsx
//
// Vista Task History (Figma frame B del archivo `AFM_SIG`).
// Server component que orquesta data y delega la UI interactiva a
// `TaskHistoryClient.tsx` (client component).
//
// Tracks del plan_34e784df:
//   F1: GET /api/task-history        ✓ committed (0b32e71)
//   F2: HeaderCard + DayCard + DayList + TabSwitcher ✓ committed (0b32e71)
//   F3: MapView con polígonos seleccionables        ✓ (working tree)
//   F4: DateRangePicker + FilterButton + ScreenshotButton ✓ (working tree)
//   F5: Esta página integradora                     ← (v1.7 Track C: refactor)
//
// v1.7 Track C:
//   - Layout: flex horizontal, mapa main (60%) + sidebar filtros+items (40%).
//   - El TaskHistoryToolbar (que vivía en el AppShell `actions` slot) se
//     elimina. Sus controles se reubicaron al sidebar (DateRangePicker en
//     el section "Periodo", ScreenshotButton al header de la sidebar,
//     FilterButton se reemplaza por inputs inline en cada section).
//   - DayCards reciben los vuelos individuales del día (sub-lista).
//   - Click en un vuelo → FlightDetailDrawer con el detalle.

import { getDb } from "@/lib/db";
import {
  aggregateNormalizedDaysWithFlights,
  type DayCard as DayCardData,
  type DayCardWithFlights,
  type TaskHistoryTotals
} from "@/lib/djiag-from-make/task-history";
import { getPolygonsInRange } from "@/lib/djiag-spatial-aggregator";

import { AppShell } from "@/components/app-shell";
import { getViewerRole } from "@/lib/auth/role";

import { TaskHistoryClient } from "./TaskHistoryClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

const DEFAULT_WINDOW_DAYS = 183; // ~6 meses, mismo que /api/task-history
const M2_PER_MU = 666.67;
const ML_PER_L = 1000;
const DEFAULT_FLIGHTS_PER_DAY = 10; // top-N para la sub-lista del DayCard
const DEFAULT_DRONE_SUGGESTIONS_LIMIT = 30;

function toIsoDate(s: string | string[] | undefined, fallback: string): string {
  if (!s) return fallback;
  const v = Array.isArray(s) ? s[0] : s;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fallback;
  return v;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

interface DailySummaryRow {
  summary_date: Date | string;
  area_mu: number | string;
  times: number;
  liters: number | string;
  duration_seconds: number;
}

function toDateString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function dateStringToEpochSec(yyyyMmDd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return null;
  const t = new Date(yyyyMmDd).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}

function dailySummaryToNormalizedDay(row: DailySummaryRow) {
  const dateStr = toDateString(row.summary_date);
  const areaMu = Number(row.area_mu) || 0;
  const liters = Number(row.liters) || 0;
  const durationSec = Number(row.duration_seconds) || 0;
  const times = Number(row.times) || 0;
  return {
    createTimestamp: dateStr ? dateStringToEpochSec(dateStr) : null,
    date: dateStr,
    workAreaM2: Math.round(areaMu * M2_PER_MU * 100) / 100,
    workTimeSec: durationSec,
    workTimeMin: Math.round(durationSec / 60),
    sortieCount: times,
    sprayUsageMl: Math.round(liters * ML_PER_L),
    sprayUsageL: Math.round(liters * 100) / 100,
    doseLPerHa:
      areaMu > 0 ? Math.round((liters / (areaMu * 0.0667)) * 100) / 100 : 0,
    hasAgriculture: true
  };
}

function isUndefinedTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "42P01") return true;
  if (typeof e.message === "string" && /relation .* does not exist/i.test(e.message)) {
    return true;
  }
  return false;
}

async function fetchDaysFromSummary(from: string, to: string) {
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
    if (isUndefinedTableError(err)) return null;
    throw err;
  }
}

interface EnrichedFlightRow {
  id: number;
  flight_id: number | string;
  start_at: Date | string;
  duration_seconds: number;
  area_m2: number | null;
  spray_usage_ml: number | null;
  drone_serial: string | null;
  pilot_name: string | null;
  parcel_id: number | null;
}

/**
 * Lee los dji_flights del rango+filtros con metadata extra para
 * soportar la sub-lista del DayCard (v1.7 Track C). Retorna los
 * flights crudos (en orden ASC por start_at) más el lookup de
 * nombres de parcela.
 */
async function fetchEnrichedFlights(args: {
  from: string;
  to: string;
  parcelId?: number;
  droneSerial?: string;
  pilot?: string;
}): Promise<{ rows: EnrichedFlightRow[]; parcelNameById: Map<number, string> }> {
  const db = getDb();
  const where: string[] = [
    "f.start_at >= $1::date",
    "f.start_at <  ($2::date + INTERVAL '1 day')"
  ];
  const params: unknown[] = [args.from, args.to];
  if (args.parcelId !== undefined) {
    params.push(args.parcelId);
    where.push(`f.parcel_id = $${params.length}`);
  }
  if (args.droneSerial) {
    params.push(args.droneSerial);
    where.push(`f.drone_serial = $${params.length}`);
  }
  if (args.pilot) {
    params.push(args.pilot);
    where.push(`f.pilot_name = $${params.length}`);
  }
  // LEFT JOIN a dji_parcels para resolver el nombre de la parcela
  // fumigada. Necesario para el FlightDetailDrawer. Sin parcel_id
  // (NULL), no hay join — el campo queda como null y el drawer
  // muestra "—".
  const sql = `
    SELECT f.id, f.flight_id, f.start_at, f.duration_seconds,
           f.area_m2, f.spray_usage_ml,
           f.drone_serial, f.pilot_name, f.parcel_id,
           p.land_name AS parcel_name
      FROM dji_flights f
      LEFT JOIN dji_parcels p ON p.id = f.parcel_id
     WHERE ${where.join(" AND ")}
     ORDER BY f.start_at ASC
  `;
  const result = await db.query<{
    id: number;
    flight_id: number | string;
    start_at: Date;
    duration_seconds: number;
    area_m2: number | null;
    spray_usage_ml: number | null;
    drone_serial: string | null;
    pilot_name: string | null;
    parcel_id: number | null;
    parcel_name: string | null;
  }>(sql, params);

  const parcelNameById = new Map<number, string>();
  for (const r of result.rows) {
    if (r.parcel_id !== null && r.parcel_name) {
      parcelNameById.set(r.parcel_id, r.parcel_name);
    }
  }

  const rows: EnrichedFlightRow[] = result.rows.map((r) => ({
    id: r.id,
    flight_id: r.flight_id,
    start_at: r.start_at,
    duration_seconds: r.duration_seconds ?? 0,
    area_m2: r.area_m2,
    spray_usage_ml: r.spray_usage_ml,
    drone_serial: r.drone_serial,
    pilot_name: r.pilot_name,
    parcel_id: r.parcel_id
  }));

  return { rows, parcelNameById };
}

async function fetchDroneSuggestions(limit: number): Promise<string[]> {
  const db = getDb();
  try {
    const result = await db.query<{ drone_serial: string }>(
      `SELECT DISTINCT drone_serial
         FROM dji_flights
        WHERE drone_serial IS NOT NULL
          AND drone_serial <> ''
        ORDER BY drone_serial ASC
        LIMIT $1`,
      [limit]
    );
    return result.rows
      .map((r) => r.drone_serial)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (err) {
    // Si la tabla no existe (CI sin materializar) o cualquier error,
    // devolvemos lista vacía — el filtro funciona sin sugerencias
    // (el usuario tipea el serial completo).
    if (isUndefinedTableError(err)) return [];
    if (process.env.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.error("[task-history] fetchDroneSuggestions failed:", err);
    }
    return [];
  }
}

function toLocalDateBogota(date: Date): string {
  const offsetMin = -5 * 60; // -300
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalTimeBogota(date: Date): string {
  const offsetMin = -5 * 60; // -300
  const localMs = date.getTime() + offsetMin * 60_000;
  const local = new Date(localMs);
  const h = String(local.getUTCHours()).padStart(2, "0");
  const m = String(local.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Decisión de paths de fetching (v1.7 Track C):
 *
 *  1. Si hay filtros de vuelo (parcelId/droneSerial/pilot):
 *     - El summary no sirve (no tiene esas dimensiones).
 *     - Re-agregamos desde dji_flights con `aggregateNormalizedDaysWithFlights`,
 *       que devuelve los días + la lista de vuelos por día.
 *
 *  2. Si NO hay filtros y existe dji_daily_summaries:
 *     - Rollup desde summary (rápido).
 *     - Sub-lista desde una query separada a dji_flights.
 *     - Esta es la diferencia clave: antes solo se agregaba desde
 *       flights, ahora también se puede componer desde summary+flights.
 *
 *  3. Si NO hay filtros y NO existe dji_daily_summaries (CI, primer
 *     deploy): fallback al path 1 (todo desde flights).
 */
async function resolveEnrichedDays(args: {
  from: string;
  to: string;
  parcelId?: number;
  droneSerial?: string;
  pilot?: string;
}): Promise<{
  enriched: DayCardWithFlights[];
  parcelNameById: Map<number, string>;
}> {
  const hasFlightFilters =
    args.parcelId !== undefined || !!args.droneSerial || !!args.pilot;

  if (hasFlightFilters) {
    // Path 1: todo desde dji_flights
    const { rows, parcelNameById } = await fetchEnrichedFlights(args);
    const enriched = aggregateNormalizedDaysWithFlights(rows);
    return { enriched, parcelNameById };
  }

  // Path 2: summary + flights
  const summaryRows = await fetchDaysFromSummary(args.from, args.to);
  if (summaryRows === null) {
    // Path 3: fallback
    const { rows, parcelNameById } = await fetchEnrichedFlights(args);
    const enriched = aggregateNormalizedDaysWithFlights(rows);
    return { enriched, parcelNameById };
  }

  const normalizedDays = summaryRows.map(dailySummaryToNormalizedDay);

  // Fetch la data de flights para la sub-lista. Si falla, devolvemos
  // los días sin flights (la page no rompe, el sidebar muestra el
  // rollup sin sub-lista).
  let byDate = new Map<string, EnrichedFlightRow[]>();
  let parcelNameById = new Map<number, string>();
  try {
    const enriched = await fetchEnrichedFlights(args);
    byDate = new Map();
    for (const r of enriched.rows) {
      const startAt =
        r.start_at instanceof Date ? r.start_at : new Date(r.start_at);
      const dateStr = toLocalDateBogota(startAt);
      const bucket = byDate.get(dateStr) ?? [];
      bucket.push(r);
      byDate.set(dateStr, bucket);
    }
    parcelNameById = enriched.parcelNameById;
  } catch {
    byDate = new Map();
  }

  const enriched: DayCardWithFlights[] = normalizedDays.map((n) => {
    const dateStr = n.date ?? "";
    const rows = (byDate.get(dateStr) ?? [])
      .slice()
      .sort((a, b) => {
        const aT =
          a.start_at instanceof Date ? a.start_at : new Date(a.start_at);
        const bT =
          b.start_at instanceof Date ? b.start_at : new Date(b.start_at);
        return aT.getTime() - bT.getTime();
      })
      .slice(0, DEFAULT_FLIGHTS_PER_DAY);
    const flights = rows.map((r) => {
      const startAt =
        r.start_at instanceof Date ? r.start_at : new Date(r.start_at);
      return {
        id: r.id,
        localDate: dateStr,
        localTime: toLocalTimeBogota(startAt),
        durationSeconds: r.duration_seconds ?? 0,
        areaMu: Math.round(((r.area_m2 ?? 0) / M2_PER_MU) * 100) / 100,
        liters: Math.round(((r.spray_usage_ml ?? 0) / ML_PER_L) * 100) / 100,
        droneSerial: r.drone_serial,
        pilotName: r.pilot_name,
        parcelId: r.parcel_id
      };
    });
    return { day: n, flights };
  });

  return { enriched, parcelNameById };
}

/**
 * Convierte un día agregado (rollup) al shape `DayCard` que muestra
 * el UI. La conversión se hace server-side para que el client reciba
 * un shape listo para renderizar (no tiene que adivinar el formato
 * de la fecha ni del duration).
 */
function normalizedDayToCard(d: DayCardWithFlights["day"]): DayCardData {
  const dateStr = d.date ?? "";
  const dateObj = dateStr ? new Date(dateStr) : new Date(NaN);
  const weekday = Number.isNaN(dateObj.getTime())
    ? ""
    : [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
      ][dateObj.getUTCDay()];
  const hours = Math.floor((d.workTimeSec ?? 0) / 3600);
  const minutes = Math.floor(((d.workTimeSec ?? 0) % 3600) / 60);
  const seconds = (d.workTimeSec ?? 0) % 60;
  return {
    date: dateStr.replace(/-/g, "/"),
    weekday,
    areaMu: Math.round(((d.workAreaM2 ?? 0) / M2_PER_MU) * 100) / 100,
    times: d.sortieCount ?? 0,
    liters: d.sprayUsageL ?? 0,
    duration: {
      hours,
      minutes,
      seconds,
      djiFormat: `${hours}Hour${minutes}min${seconds}s`
    }
  };
}

function computeTotalsLocal(days: DayCardData[]): TaskHistoryTotals {
  let areaMu = 0;
  let times = 0;
  let liters = 0;
  let durationSeconds = 0;
  for (const d of days) {
    areaMu += d.areaMu;
    times += d.times;
    liters += d.liters;
    durationSeconds +=
      d.duration.hours * 3600 + d.duration.minutes * 60 + d.duration.seconds;
  }
  return {
    areaMu: Math.round(areaMu * 100) / 100,
    times,
    liters: Math.round(liters * 100) / 100,
    duration: {
      hours: Math.floor(durationSeconds / 3600),
      minutes: Math.floor((durationSeconds % 3600) / 60),
      seconds: durationSeconds % 60,
      djiFormat: `${Math.floor(durationSeconds / 3600)}Hour${Math.floor(
        (durationSeconds % 3600) / 60
      )}min${durationSeconds % 60}s`
    }
  };
}

export default async function TaskHistoryPage({ searchParams }: PageProps) {
  const from = toIsoDate(searchParams.from, daysAgoIso(DEFAULT_WINDOW_DAYS));
  const to = toIsoDate(searchParams.to, todayIso());
  const parcelIdRaw = Array.isArray(searchParams.parcelId)
    ? searchParams.parcelId[0]
    : searchParams.parcelId;
  const parcelId =
    parcelIdRaw && /^\d+$/.test(parcelIdRaw) ? Number(parcelIdRaw) : undefined;
  const droneSerial = (
    Array.isArray(searchParams.droneSerial)
      ? searchParams.droneSerial[0]
      : searchParams.droneSerial
  )?.trim() || undefined;
  const pilot = (
    Array.isArray(searchParams.pilot) ? searchParams.pilot[0] : searchParams.pilot
  )?.trim() || undefined;

  // Enriquecer: rollup + sub-lista en una sola pasada server-side.
  // La query a dji_flights ya viene con LEFT JOIN a dji_parcels para
  // resolver el nombre de la parcela fumigada.
  const [{ enriched, parcelNameById: parcelsFromFlights }, polygons, droneSuggestions] =
    await Promise.all([
      resolveEnrichedDays({ from, to, parcelId, droneSerial, pilot }),
      getPolygonsInRange({
        from,
        to,
        onlyFumigated: true,
        parcelId,
        droneSerial,
        pilot
      }),
      fetchDroneSuggestions(DEFAULT_DRONE_SUGGESTIONS_LIMIT)
    ]);

  // Rollup cards (mismo shape que la v1.6) para los KPIs. En v1.7 Track C
  // el header de totales se removió del cuerpo del screen (vive como
  // el FilterSidebar header en su lugar). Mantenemos la conversión por
  // simetría con el API /api/task-history y para futuro reuso.
  const days = enriched.map((e) => normalizedDayToCard(e.day));

  // Lookup de nombre de parcela por id (para el FlightDetailDrawer).
  // Preferencia: lookup del JOIN flights+parcels (más completo,
  // incluye parcelas fumigadas que pueden no estar en polygons).
  // Fallback: polygons. Si falta algún nombre, el drawer muestra
  // "Parcela #N" (fallback en el componente).
  const parcelNameById = new Map<number, string>();
  for (const [id, name] of parcelsFromFlights) {
    parcelNameById.set(id, name);
  }
  for (const p of polygons) {
    if (p.parcelId && p.landName && !parcelNameById.has(p.parcelId)) {
      parcelNameById.set(p.parcelId, p.landName);
    }
  }

  // v1.5: sidebar gate.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="task-history"
      eyebrow="Trazabilidad DJI"
      subtitle="Rollup diario de fumigaciones con KPIs, mapa de parcelas fumigadas y filtros por dron, parcela o piloto."
      title="Historial de tareas"
      viewerRole={viewerRole}
    >
      <TaskHistoryClient
        days={enriched}
        droneSuggestions={droneSuggestions}
        from={from}
        parcelNameById={parcelNameById}
        polygons={polygons}
        selectedParcelId={parcelId ?? null}
        to={to}
      />
    </AppShell>
  );
}
