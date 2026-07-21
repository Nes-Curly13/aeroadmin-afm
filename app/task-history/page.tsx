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
//   F5: Esta página integradora                     ← (en curso)

import { getDb } from "@/lib/db";
import {
  aggregateNormalizedDays,
  type FlightLikeRow,
  type DayCard as DayCardData,
  type TaskHistoryTotals
} from "@/lib/djiag-from-make/task-history";
import { getPolygonsInRange } from "@/lib/djiag-spatial-aggregator";

import { AppShell } from "@/components/app-shell";
import { getViewerRole } from "@/lib/auth/role";

import { TaskHistoryClient } from "./TaskHistoryClient";
import { TaskHistoryToolbar } from "./TaskHistoryToolbar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

const DEFAULT_WINDOW_DAYS = 183; // ~6 meses, mismo que /api/task-history
const M2_PER_MU = 666.67;
const ML_PER_L = 1000;

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

async function resolveDays(args: {
  from: string;
  to: string;
  parcelId?: number;
  droneSerial?: string;
  pilot?: string;
}) {
  const hasFlightFilters =
    args.parcelId !== undefined || !!args.droneSerial || !!args.pilot;
  if (hasFlightFilters) {
    const flights = await fetchFilteredFlights(args);
    return aggregateNormalizedDays(flights);
  }
  const summaryRows = await fetchDaysFromSummary(args.from, args.to);
  if (summaryRows !== null) {
    return summaryRows.map(dailySummaryToNormalizedDay);
  }
  const flights = await fetchFilteredFlights(args);
  return aggregateNormalizedDays(flights);
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

function dayToCard(day: {
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
}): DayCardData {
  const dateStr = day.date ?? "";
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
  const hours = Math.floor((day.workTimeSec ?? 0) / 3600);
  const minutes = Math.floor(((day.workTimeSec ?? 0) % 3600) / 60);
  const seconds = (day.workTimeSec ?? 0) % 60;
  return {
    date: dateStr.replace(/-/g, "/"),
    weekday,
    areaMu: Math.round(((day.workAreaM2 ?? 0) / M2_PER_MU) * 100) / 100,
    times: day.sortieCount ?? 0,
    liters: day.sprayUsageL ?? 0,
    duration: {
      hours,
      minutes,
      seconds,
      djiFormat: `${hours}Hour${minutes}min${seconds}s`
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

  const normalizedDays = await resolveDays({
    from,
    to,
    parcelId,
    droneSerial,
    pilot
  });
  const days: DayCardData[] = normalizedDays.map(dayToCard);
  const totals = computeTotalsLocal(days);

  // Polígonos del mapa: TODOS los parcels fumigados en el rango
  // (decisión 5: same color, click → filter).
  const polygons = await getPolygonsInRange({
    from,
    to,
    onlyFumigated: true,
    parcelId,
    droneSerial,
    pilot
  });

  // v1.5: sidebar gate.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      actions={
        <TaskHistoryToolbar from={from} polygonCount={polygons.length} to={to} />
      }
      activeSection="task-history"
      eyebrow="Trazabilidad DJI"
      subtitle="Rollup diario de fumigaciones con KPIs, mapa de parcelas fumigadas y filtros por dron, parcela o piloto."
      title="Historial de tareas"
      viewerRole={viewerRole}
    >
      <TaskHistoryClient
        days={days}
        polygons={polygons}
        selectedParcelId={parcelId ?? null}
        totals={totals}
      />
    </AppShell>
  );
}
