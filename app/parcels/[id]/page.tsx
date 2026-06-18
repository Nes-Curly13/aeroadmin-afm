import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { ParcelDetail } from "@/components/parcels/parcel-detail";
import { getParcelById, getParcelsNormalized } from "@/api/repositories";

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

  const [parcel, allParcels] = await Promise.all([
    getParcelById(id),
    getParcelsNormalized(1, 200)
  ]);

  if (!parcel) {
    notFound();
  }

  // Calcular índice de la parcela actual para navegación prev/next
  const currentIndex = allParcels.data.findIndex((p) => p.id === id);
  const prev = currentIndex > 0 ? allParcels.data[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < allParcels.data.length - 1
      ? allParcels.data[currentIndex + 1]
      : null;

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
        </div>
      }
      activeSection="map"
      eyebrow={`Parcela #${id}`}
      parcelsCount={allParcels.data.length}
      subtitle={
        parcel.land_name
          ? `Detalle operativo de ${parcel.land_name}`
          : "Detalle operativo de la parcela"
      }
      title={parcel.land_name ?? "Parcela sin nombre"}
    >
      <ParcelDetail parcel={parcel} />
    </AppShell>
  );
}
