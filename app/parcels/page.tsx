// app/parcels/page.tsx
//
// BUG 1 (audit ui-ux-2026-07): el <EmptyState> del map-view.tsx tiene
// cta={ href: "/parcels", ... } pero esta página no existía → 404 al
// hacer click. Esta página cierra ese flujo.
//
// Decisiones:
//   - Server component que llama a getParcelsNormalized(1, 1000).
//     Traemos 1000 filas de una para que el listado se vea completo sin
//     round-trips al server por paginación. El dataset actual es ~1207
//     parcelas; si crece a 10k+ se reemplaza por paginación server-side
//     con searchParams (mismo patrón que /task-history).
//   - La UI interactiva (sort, búsqueda, paginación client-side) vive
//     en el client island `ParcelsList`. La orquestación de data es
//     server-side (SDD §3: pages no hacen queries en client).
//   - activeSection="parcels" para que el sidebar marque este item
//     como activo (BUG 2 del mismo audit).

import { AppShell } from "@/components/app-shell";
import { ParcelsList } from "@/components/parcels/parcels-list";
import { getParcelsNormalized } from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

// Tamaño generoso: la BD actual tiene 1207 parcelas y `getParcelsNormalized`
// está cacheado (tag `afm:parcels`, TTL 60s). Si el dataset crece, migrar
// a paginación server-side vía searchParams.
const PARCELS_LIMIT = 1000;

export default async function ParcelsPage() {
  const parcelsResult = await getParcelsNormalized(1, PARCELS_LIMIT);
  // v1.5: sidebar gate. Sin DB hit, lee del JWT.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="parcels"
      eyebrow="Vista agregada"
      parcelsCount={parcelsResult.data.length}
      subtitle="Listado completo de parcelas importadas desde DJI Agras. Click en una fila para abrir el detalle."
      title="Parcelas"
      viewerRole={viewerRole}
    >
      <ParcelsList parcels={parcelsResult.data} />
    </AppShell>
  );
}
