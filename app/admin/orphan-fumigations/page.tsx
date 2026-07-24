// app/admin/orphan-fumigations/page.tsx
//
// Sprint G1 — Hoja de vida de la parcela.
//
// Página admin para revisar y vincular manualmente las fumigaciones
// huérfanas (parcel_id IS NULL). Las huérfanas vienen del backfill
// `backfill-fumigations-from-flights` cuando el spatial join no encontró
// una parcela para el flight.
//
// Patrón: server component llama al repository DIRECTO, NO al endpoint
// (misma justificación que /parcels/[id]/timeline — ver el comentario
// de esa page). El endpoint `/api/admin/orphan-fumigations` queda
// para clientes externos (futuro dashboard widget, script CLI, etc.).
//
// Auth: la page usa `getViewerRole` para el sidebar gate (Sprint D
// v1.5). El client component hace el POST al endpoint, que valida
// role=admin de nuevo (defense in depth).

import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { OrphanFumigationsClient } from "@/app/admin/orphan-fumigations/orphan-fumigations-client";
import { getFumigationDbStats, getOrphanFumigations, getParcelsNormalized } from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function OrphanFumigationsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Cargamos en paralelo: huérfanas, stats, y el catálogo de parcelas
  // para el selector de "Vincular a..." (limitado a 200 para no
  // explotar el bundle — los cañeros no manejan más de 200 parcelas
  // activas en su operación).
  const [{ rows, total }, dbStats, parcelsList, viewerRole] = await Promise.all([
    getOrphanFumigations(PAGE_SIZE, offset),
    getFumigationDbStats(),
    getParcelsNormalized(1, 200),
    getViewerRole()
  ]);

  // Si no es admin, no muestra la página (defense in depth: la page
  // ya no muestra datos sensibles, pero igual bloqueamos).
  if (viewerRole !== "admin") {
    notFound();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Catálogo de parcelas para el selector. Solo id + land_name (lo
  // que necesita el form). NO le pasamos la geometría ni el resto de
  // la metadata — el bundle ya pesa con los 25 huérfanos.
  const parcelOptions = parcelsList.data.map((p) => ({
    id: p.id,
    label: `${p.id} — ${p.land_name ?? p.external_id ?? "(sin nombre)"}`
  }));

  return (
    <AppShell
      activeSection="parcels"
      eyebrow="Admin"
      subtitle="Fumigaciones del import que no se pudieron asignar a una parcela. Revisá y vinculá manualmente."
      title="Fumigaciones sin parcela"
      viewerRole={viewerRole}
    >
      <OrphanFumigationsClient
        dbStats={dbStats}
        initialPage={page}
        initialRows={rows}
        parcelOptions={parcelOptions}
        total={total}
        totalPages={totalPages}
      />
    </AppShell>
  );
}
