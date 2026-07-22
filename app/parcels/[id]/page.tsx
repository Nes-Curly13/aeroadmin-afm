import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ParcelDetail } from "@/components/parcels/parcel-detail";
import { ParcelFumigations } from "@/components/parcels/parcel-fumigations";
import {
  getFumigationEventsByParcel,
  getFumigationSchedule,
  getParcelById,
  getParcelsNormalized
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

  const [parcel, allParcels, schedule, events] = await Promise.all([
    getParcelById(id),
    getParcelsNormalized(1, 200),
    getFumigationSchedule(id),
    getFumigationEventsByParcel(id)
  ]);

  if (!parcel) {
    notFound();
  }

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
          events={events}
          parcel={parcel}
          schedule={schedule}
          status={status}
        />
        <ParcelDetail parcel={parcel} />
      </div>
    </AppShell>
  );
}
