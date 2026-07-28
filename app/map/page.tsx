import { AppShell } from "@/components/app-shell";
import { MapPageClient } from "@/components/map/map-page-client";
import {
  getFumigatedParcelIdsSince,
  getFumigationsByMonth,
  getFumigationsSummary,
  getParcelsNormalized,
  getParcelsSummary
} from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { toDateString } from "@/lib/format";
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
  const droneCode = parseDroneParam(searchParams.drone);
  const crop = parseCropParam(searchParams.crop);
  const fumigated = parseFumigatedParam(searchParams.fumigated);

  const sixMonthsAgo = toDateString(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6)) ?? "1970-01-01";

  const [parcelsResult, fumigatedIds, summary, months] = await Promise.all([
    getParcelsNormalized(1, 200, {
      droneModelCode: droneCode ?? undefined,
      fieldType: crop || undefined
    }),
    getFumigatedParcelIdsSince(sixMonthsAgo),
    getParcelsSummary(),
    // v2.0: histograma mensual de fumigaciones para el TimeRange slider.
    // Computamos sobre el set visible post-fumigated filter (idem summary).
    // getFumigationsByMonth({}) corre primero; recalculamos con parcelIds
    // visibles abajo para evitar pagar 2 round-trips cuando no hay visible.
    getFumigationsByMonth({})
  ]);

  const visibleParcels = applyFumigatedFilter(parcelsResult.data, fumigatedIds, fumigated);

  // v2.0: recalculamos summary + months sobre el set visible.
  // 2 queries chicas en paralelo (set de N parcel_ids). Vale los round-trips.
  const [summaryVisible, monthsVisible] = await Promise.all([
    getFumigationsSummary({ parcelIds: visibleParcels.map((p) => p.id) }),
    getFumigationsByMonth({ parcelIds: visibleParcels.map((p) => p.id) })
  ]);

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
        fumigationsByMonth={monthsVisible}
        fumigationsSummary={summaryVisible}
        parcels={visibleParcels}
        resultCount={visibleParcels.length}
        summary={summary as Parameters<typeof MapPageClient>[0]["summary"]}
      />
    </AppShell>
  );
}
