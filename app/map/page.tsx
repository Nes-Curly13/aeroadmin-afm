import { AppShell } from "@/components/app-shell";
import { MapPageClient } from "@/components/map/map-page-client";
import {
  getFumigatedParcelIdsSince,
  getFumigationsByMonth,
  getFumigationsForMap,
  getFumigationsSummary,
  getParcelsNormalized
} from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { toDateString } from "@/lib/format";
import { toMapFumigationEvent } from "@/lib/map-filter-logic";
import { computeParcelCentroid } from "@/lib/map-filter-logic";
import type { DjiParcelRecord } from "@/lib/types";

/**
 * /map — vista espacial principal.
 *
 * v2.0 (2026-07-28) — sprint S5, adaptación del mockup V0:
 *   - **KPIs overlay** sobre el mapa (Aplicaciones / Hectáreas / Volumen /
 *     Vuelos) usando el nuevo `KpiPill` (components/ui/kpi-pill.tsx).
 *     El summary se calcula server-side con `getFumigationsSummary()`
 *     sobre el set de parcels visibles y se pasa al client.
 *   - Migración Leaflet → MapLibre ya integrada en `MapView` (no toca
 *     este page).
 *   - (Pendiente sprint S5) rail derecho con lista de parcelas, toggles
 *     accesibles para capas, time-range slider con animación.
 *
 * v1.8 (2026-07-27) — refactor de layout según mockup del operador:
 *   - El page header y el drawer de filtros pasan a vivir en un
 *     Client Component (`MapPageClient`) que maneja el estado del
 *     drawer (colapsado/expandido). El chip "X Parcelas" del header
 *     se re-renderea con cada cambio de filtro (URL navigation).
 *   - El AppShell recibe `hidePageHeader={true}` para NO pintar el
 *     bloque default de título (eyebrow + h1 + subtítulo) — el
 *     header ahora vive dentro de `MapPageClient`.
 *   - El layout del body (mapa + drawer) también vive en
 *     `MapPageClient`, no en la page server-side. La page sigue
 *     siendo la que ejecuta las queries paralelas del critical path.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

type FumigatedFilter = "" | "yes" | "no";
type CropFilter = "" | "Farmland" | "Orchards";

function parseDroneParam(raw: string | string[] | undefined): number | null {
  if (!raw) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCropParam(raw: string | string[] | undefined): CropFilter {
  if (!raw) return "";
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "Farmland" || value === "Orchards") return value;
  return "";
}

function parseFumigatedParam(raw: string | string[] | undefined): FumigatedFilter {
  if (!raw) return "";
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "yes" || value === "no") return value;
  return "";
}

function applyFumigatedFilter(
  parcels: DjiParcelRecord[],
  fumigatedIds: Set<number>,
  mode: FumigatedFilter
): DjiParcelRecord[] {
  if (mode === "") return parcels;
  if (mode === "yes") return parcels.filter((p) => fumigatedIds.has(p.id));
  return parcels.filter((p) => !fumigatedIds.has(p.id));
}

export default async function MapPage({ searchParams }: PageProps) {
  // v2.2.2 (S7.2 hotfix): Next.js 16 cambió `searchParams` a Promise
  // (era sync en versiones anteriores). Hay que unwrap con await
  // antes de acceder a las propiedades.
  const params = await searchParams;
  const droneCode = parseDroneParam(params.drone);
  const crop = parseCropParam(params.crop);
  const fumigated = parseFumigatedParam(params.fumigated);

  const sixMonthsAgo = toDateString(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6)) ?? "1970-01-01";

  const [parcelsResult, fumigatedIds, months] = await Promise.all([
    getParcelsNormalized(1, 200, {
      droneModelCode: droneCode ?? undefined,
      fieldType: crop || undefined
    }),
    getFumigatedParcelIdsSince(sixMonthsAgo),
    // v2.0: histograma mensual de fumigaciones para el TimeRange slider.
    // Computamos sobre el set visible post-fumigated filter (idem summary).
    // getFumigationsByMonth({}) corre primero; recalculamos con parcelIds
    // visibles abajo para evitar pagar 2 round-trips cuando no hay visible.
    getFumigationsByMonth({})
  ]);

  const visibleParcels = applyFumigatedFilter(parcelsResult.data, fumigatedIds, fumigated);

  // v2.0: recalculamos summary + months sobre el set visible.
  // 2 queries chicas en paralelo (set de N parcel_ids). Vale los round-trips.
  // v2.1 (S6): agregamos `getFumigationsForMap()` para que el client
  // pueda derivar KPIs + filtrar por source/status sin round-trip extra.
  const [summaryVisible, monthsVisible, eventsRaw] = await Promise.all([
    getFumigationsSummary({ parcelIds: visibleParcels.map((p) => p.id) }),
    getFumigationsByMonth({ parcelIds: visibleParcels.map((p) => p.id) }),
    getFumigationsForMap({ parcelIds: visibleParcels.map((p) => p.id) })
  ]);

  // Pre-computamos centroides de las parcelas visibles una sola vez y
  // los inyectamos en cada evento (`toMapFumigationEvent` los necesita).
  // Sobre 1200 parcelas es O(N) — despreciable. Sobre 10k+ habría que
  // mover el join a la query SQL.
  const centroidByParcel = new Map<number, { lng: number | null; lat: number | null }>();
  for (const p of visibleParcels) {
    centroidByParcel.set(p.id, computeParcelCentroid(p));
  }
  const fumigationEvents = eventsRaw.map((e) =>
    toMapFumigationEvent(e, centroidByParcel.get(e.parcel_id) ?? { lng: null, lat: null })
  );

  const viewerRole = await getViewerRole();

  return (
    <AppShell
      hidePageHeader
      activeSection="map"
      eyebrow=""
      highAlertsCount={0}
      parcelsCount={visibleParcels.length}
      subtitle="Mapa operativo de parcelas DJI con geometría y configuración de vuelo"
      title="Mapa de Parcelas"
      viewerRole={viewerRole}
    >
      <MapPageClient
        alerts={[]}
        flights={[]}
        fumigatedParcelIds={fumigatedIds}
        fumigationEvents={fumigationEvents}
        fumigationsByMonth={monthsVisible}
        fumigationsSummary={summaryVisible}
        parcels={visibleParcels}
      />
    </AppShell>
  );
}
