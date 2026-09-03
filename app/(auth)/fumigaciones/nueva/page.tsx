import { PageHeader } from "@/components/page-header";
import { NewFumigationPageClient } from "@/components/admin/fumigations/new-fumigation-page-client";
import { getRecentParcelsForPicker } from "@/api/repositories";

/**
 * /fumigaciones/nueva — formulario de alta de fumigación en página completa.
 *
 * Sprint 2026-08-05 — feature/nav-fumigaciones.
 *
 * Cierra el pedido del operador de tener "más comodidad" en el form
 * de nueva fumigación. Antes la única entrada era el NewFumigationDialog
 * (max-w-2xl = 672px, chico para los 9 campos del form + el mapa
 * del wizard de selección de parcela).
 *
 * Esta página ofrece:
 *   - 2 columnas en desktop: form a la izquierda (60%),
 *     mapa satelital a la derecha (40%)
 *   - Mapa basemap Sentinel-2 2024 (EOX) — el mismo del /geovisor
 *   - Selección de parcela en 2 modos: autocomplete live o
 *     dibujo en mapa (reuso del ParcelDrawer)
 *   - Form completo del RegisterFumigationForm con TODO el espacio
 *
 * El form sigue siendo client (`NewFumigationPageClient`) — necesitamos
 * useState (parcela elegida + form) + map state.
 *
 * Auth: el middleware ya gatea /admin/* y el handler del POST
 * valida role admin|supervisor. Esta página no requiere role
 * especial — el rol del operador fumigador (que es el que registra
 * fumigaciones manuales) ya está cubierto por el flow actual.
 */

export const metadata = {
  title: "Nueva fumigación | AFM",
  description:
    "Registra una fumigación manual con mapa satelital y form con espacio."
};

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ parcel?: string; q?: string }>;
}

export default async function NuevaFumigacionPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const initialParcelId = sp.parcel ? Number(sp.parcel) : null;
  const initialQuery = (sp.q ?? "").trim();

  // Sprint Fase 2 / Q4 (2026-08-23): si la URL trae `?q=...`,
  // pre-filtramos server-side con ILIKE. Si no, los 500 más recientes.
  // El Picker local filtra además sobre el resultado, así que el
  // operador puede refinar la búsqueda (server fetch inicial +
  // client filter incremental).
  //
  // Limit 500 sigue siendo suficiente para el Valle del Cauca
  // (~1200 parcelas). Con search, el cap sube implícito a 2000
  // (vía `getRecentParcelsForPicker`).
  const recentParcels = await getRecentParcelsForPicker(500, initialQuery);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <PageHeader
        title="Nueva fumigación"
        description="Registra una fumigación manual. El mapa de la derecha usa Sentinel-2 cloudless 2024 (basemap satelital) para que el operador vea claramente el lote donde va a aplicar."
      />
      <NewFumigationPageClient
        initialParcelId={initialParcelId}
        recentParcels={recentParcels}
      />
    </div>
  );
}
