import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { FumigationTimeline } from "@/components/parcels/fumigation-timeline";
import { IntervalChart, type IntervalPoint } from "@/components/parcels/interval-chart";
import { ParcelDetail } from "@/components/parcels/parcel-detail";
import { ParcelFumigationHistory } from "@/components/parcels/parcel-fumigation-history";
import { ParcelFumigations } from "@/components/parcels/parcel-fumigations";
import { ParcelMap } from "@/components/parcels/parcel-map";
import {
  getFlightPointsForMap,
  getFumigationDbStats,
  getFumigationEventsByParcel,
  getFumigationFlightTrace,
  getFumigationSchedule,
  getFumigationYearlySummary,
  getFumigationYearTotals,
  getParcelById,
  getParcelsNormalized,
  getScheduleHistory
} from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { daysBetween } from "@/lib/format";
import { daysUntilNextDue, getFumigationStatus } from "@/lib/fumigation-cadence";
import { COLORS } from "@/lib/ui-tokens";

export const dynamic = "force-dynamic";

export default async function ParcelPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id < 1) {
    notFound();
  }

  // Sprint G2 — agregamos al Promise.all:
  //   - summary + totals: resumen anual del año actual
  //   - scheduleHistory: cambios de cadencia (últimos 10)
  //   - flightTraces: flights de las fumigaciones con flight_ids
  //     (solo las del import con trazabilidad)
  const currentYear = new Date().getUTCFullYear();

  const [
    parcel,
    allParcels,
    schedule,
    events,
    dbStats,
    summary,
    totals,
    scheduleHistory,
    allFlights
  ] = await Promise.all([
    getParcelById(id),
    getParcelsNormalized(1, 200),
    getFumigationSchedule(id),
    getFumigationEventsByParcel(id),
    getFumigationDbStats(),
    getFumigationYearlySummary(id, currentYear),
    getFumigationYearTotals(id, currentYear),
    getScheduleHistory(id, 10),
    getFlightPointsForMap()
  ]);

  if (!parcel) {
    notFound();
  }

  // Flight traces: solo para fumigaciones del import con flight_ids.
  // Hacemos 1 Promise.all con N queries (cada fumigación = 1 query).
  // N es chico (5-10 fumigaciones por parcela), acceptable.
  // Si en el futuro esto se vuelve lento (>50 fumigaciones con
  // flight_ids por parcela), se reemplaza por una sola query
  // que traiga todos los flights de la parcela en una sola vez.
  const traceableEvents = events.filter(
    (e) => e.flight_ids && e.flight_ids.length > 0
  );
  const flightTraces: Record<number, Awaited<ReturnType<typeof getFumigationFlightTrace>>> = {};
  await Promise.all(
    traceableEvents.map(async (e) => {
      flightTraces[e.id] = await getFumigationFlightTrace(e.id);
    })
  );

  const currentIndex = allParcels.data.findIndex((p) => p.id === id);
  const prev = currentIndex > 0 ? allParcels.data[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < allParcels.data.length - 1
      ? allParcels.data[currentIndex + 1]
      : null;

  const cadence = schedule?.recommended_cadence_days ?? 14;
  const status = getFumigationStatus(schedule?.last_fumigation_date ?? null, cadence);
  const days = daysUntilNextDue(schedule?.last_fumigation_date ?? null, cadence);

  // v2.1 (sprint S7) — derivaciones para los 3 componentes nuevos del
  // detalle (FumigationTimeline, IntervalChart, ParcelMap). Se derivan
  // server-side de los datos que ya tenemos en el critical path
  // (events, schedule, flightTraces, parcel).
  //
  // IntervalChart: pares (fumigacion_anterior, fumigacion_actual)
  // con la diferencia en días. `events` viene DESC desde el repo
  // (fumigation_date DESC, recorded_at DESC), así que ordenamos
  // ascendente para calcular los gaps correctamente.
  const eventsAsc = [...events].sort((a, b) => a.fumigation_date.localeCompare(b.fumigation_date));
  const intervalPoints: IntervalPoint[] = eventsAsc.slice(0, -1).map((curr, i) => {
    const prev = eventsAsc[i];
    const gap = daysBetween(prev.fumigation_date, curr.fumigation_date) ?? 0;
    return { date: curr.fumigation_date, gap };
  });

  // v2.1 (sprint S7.2) — flights como markers en el ParcelMap.
  // Filtramos los `allFlights` por el parcelId actual. El batch trae
  // TODOS los flights (limit 2000); para ~1200 parcelas, el filtro
  // en memoria es O(1) y la query es O(1). Si el dataset crece a
  // >100k flights, agregar WHERE parcel_id = ANY en el SQL.
  const parcelFlights: Array<{ id: number; lng: number; lat: number; pilot?: string }> =
    allFlights
      .filter((f) => f.parcel_id === id)
      .map((f) => ({
        id: f.flight_id,
        lng: f.lng,
        lat: f.lat,
        pilot: f.pilot_name ?? undefined
      }));

  // v2.1 — color del polígono según status de cadencia. Reusa el
  // patron del V0 (geovisor-client.tsx).
  const parcelColor =
    status === "overdue"
      ? COLORS.danger
      : status === "due_soon"
        ? COLORS.warning
        : status === "no_history"
          ? COLORS["neutral-medium"] ?? "#5a4136"
          : COLORS.success;

  // FumigationTimeline: aplanamos los flights por evento para que el
  // componente los muestre por fumigación.
  // v2.1: `FlightTraceRow` no tiene `started_at` propio — usamos la fecha
  // de la fumigación como fallback.
  const timelineFlights: Array<{
    id: number;
    date: string;
    droneNickname: string | null;
    pilotName: string | null;
    areaHa: number | null;
    durationSeconds: number | null;
  }> = [];
  for (const [eventIdStr, flights] of Object.entries(flightTraces)) {
    const eventId = Number(eventIdStr);
    const ev = events.find((e) => e.id === eventId);
    if (!ev) continue;
    for (const f of flights ?? []) {
      timelineFlights.push({
        id: f.id,
        date: f.start_at ? new Date(f.start_at).toISOString().slice(0, 10) : ev.fumigation_date,
        droneNickname: f.drone_nickname ?? null,
        pilotName: f.pilot_name ?? null,
        areaHa: f.area_m2 != null ? f.area_m2 / 10000 : null,
        durationSeconds: f.duration_seconds ?? null
      });
    }
  }

  // v1.5: sidebar gate.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-2">
          {prev ? (
            <Link
              className="rounded-full border border-[#cfd8d3] px-3 py-1.5 text-xs font-semibold text-[#0b5f2d]"
              href={`/parcels/${prev.id}`}
            >
              ← {prev.land_name ?? "Anterior"}
            </Link>
          ) : null}
          {next ? (
            <Link
              className="rounded-full border border-[#cfd8d3] px-3 py-1.5 text-xs font-semibold text-[#0b5f2d]"
              href={`/parcels/${next.id}`}
            >
              {next.land_name ?? "Siguiente"} →
            </Link>
          ) : null}
          <Link
            className="rounded-full bg-[#0b5f2d] px-3 py-1.5 text-xs font-semibold text-white"
            data-testid="parcel-detail-timeline-link"
            href={`/parcels/${id}/timeline`}
          >
            Ver timeline
          </Link>
        </div>
      }
      activeSection="parcels"
      eyebrow={`Parcela #${id}`}
      parcelsCount={allParcels.data.length}
      subtitle={
        parcel.land_name
          ? `Detalle operativo de ${parcel.land_name}`
          : "Detalle operativo de la parcela"
      }
      title={parcel.land_name ?? "Parcela sin nombre"}
      viewerRole={viewerRole}
    >
      <div className="space-y-5">
        <ParcelFumigations
          daysUntilNextDue={days}
          dbStats={dbStats}
          events={events}
          parcel={parcel}
          schedule={schedule}
          status={status}
        />
        <ParcelFumigationHistory
          events={events}
          initialFlightTraces={flightTraces}
          initialSummary={summary}
          initialTotals={totals}
          initialYear={currentYear}
          parcel={parcel}
          scheduleHistory={scheduleHistory}
        />

        {/* v2.1 (sprint S7) — componentes del V0 portados al detalle. */}
        <div className="space-y-4">
          <FumigationTimeline
            cadenceDays={cadence}
            flights={timelineFlights}
            fumigations={events}
          />
          {intervalPoints.length > 0 ? (
            <IntervalChart cadenceDays={cadence} points={intervalPoints} />
          ) : null}
          <ParcelMap
            color={parcelColor}
            flights={parcelFlights}
            geom={parcel.spray_geometry}
          />
        </div>

        <ParcelDetail parcel={parcel} />
      </div>
    </AppShell>
  );
}
