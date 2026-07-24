import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ParcelDetail } from "@/components/parcels/parcel-detail";
import { ParcelFumigationHistory } from "@/components/parcels/parcel-fumigation-history";
import { ParcelFumigations } from "@/components/parcels/parcel-fumigations";
import {
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
import { daysUntilNextDue, getFumigationStatus } from "@/lib/fumigation-cadence";

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
    scheduleHistory
  ] = await Promise.all([
    getParcelById(id),
    getParcelsNormalized(1, 200),
    getFumigationSchedule(id),
    getFumigationEventsByParcel(id),
    getFumigationDbStats(),
    getFumigationYearlySummary(id, currentYear),
    getFumigationYearTotals(id, currentYear),
    getScheduleHistory(id, 10)
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
        <ParcelDetail parcel={parcel} />
      </div>
    </AppShell>
  );
}
