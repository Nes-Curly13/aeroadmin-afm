"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { FilterSidebar, FilterSidebarSection } from "@/components/ui/filter-sidebar";
import type { getParcelsSummary } from "@/api/repositories";

/**
 * components/map/map-filter-sidebar.tsx
 *
 * v1.7 Track B — sidebar de filtros del mapa (mapa a la izquierda, filtros a
 * la derecha).
 *
 * Reemplaza a `components/map/map-filters-panel.tsx` (v1.3 Track A),
 * que era un `<form>` horizontal arriba del mapa. La nueva versión
 * envuelve los 3 selects en `<FilterSidebar>` + `<FilterSidebarSection>`
 * (primitives de v1.7) y la page la monta como sidebar a la derecha
 * del mapa en el body de `/map`.
 *
 * Decisiones:
 *   - **Filtros = URL searchParams** (mismo patrón que v1.3). Permite
 *     compartir filtros por link, navegar con back/forward, y la
 *     página es server-rendered: el filtro se aplica en el SQL antes
 *     de mandar los polígonos al cliente.
 *   - **`router.push()` con `scroll: false`**: el mapa del operador
 *     puede tener mucho zoom/pan. Al cambiar filtro, no queremos que
 *     la página salte al top.
 *   - **`onClear` del sidebar** navega a `/map` sin query string. Es
 *     el equivalente del "Limpiar filtros" del v1.3 pero provisto por
 *     el primitive (no por este componente).
 *   - **Deduplicar drones por `drone_model_code`**: `getParcelsSummary`
 *     agrupa por (code, name); si hay lotes con el mismo code pero
 *     nombres distintos, solo dejamos el primero.
 *   - **Omitir drones con `code` null**: no se puede filtrar SQL por
 *     NULL desde un <select> con value="" — se filtra client-side.
 *   - **Conteo del section "Drones"**: usamos el conteo de drones
 *     únicos (post-dedup), no el largo de `summary`, para que el badge
 *     del primitive refleje opciones reales en el select.
 *   - **Conteo del section "Cultivo"**: 2 (Farmland + Orchards),
 *     no el total de tipos en la BD. Es lo que el usuario puede
 *     elegir.
 *   - **Conteo del section "Fumigadas"**: no se pasa `count`, solo
 *     `activeCount` cuando hay filtro activo.
 */

type ParcelsSummaryRow = Awaited<ReturnType<typeof getParcelsSummary>>[number];

export interface MapFilterSidebarProps {
  /**
   * Filas del summary de parcelas. Se usa SOLO para derivar la lista
   * única de `drone_model_code` + `drone_model_name` que aparece en
   * el select de "Drones".
   */
  summary: ParcelsSummaryRow[];
  /**
   * Conteo de parcelas visibles después de aplicar todos los filtros.
   * Se muestra en el badge del header del sidebar (a11y: el operador
   * ve cuántas parcelas pasan el filtro actual).
   */
  resultCount: number;
}

/**
 * Tipos válidos del filtro `fumigated`. Documentado en el type para
 * que el page.tsx (que parsea searchParams) pueda reutilizarlo.
 */
export type FumigatedFilter = "" | "yes" | "no";

/**
 * Parsea el searchParam `fumigated` a un valor tipado. Default = "" (omit).
 * Cualquier valor fuera de ["", "yes", "no"] colapsa a "" (no rompe la URL).
 */
export function parseFumigatedParam(raw: string | null | undefined): FumigatedFilter {
  if (raw === "yes" || raw === "no") return raw;
  return "";
}

/**
 * Parsea el searchParam `crop` a un subset conocido.
 * Default = "". El page.tsx valida que sea "Farmland" o "Orchards"
 * antes de pasarlo al filtro SQL.
 */
export type CropFilter = "" | "Farmland" | "Orchards";

export function parseCropParam(raw: string | null | undefined): CropFilter {
  if (raw === "Farmland" || raw === "Orchards") return raw;
  return "";
}

/**
 * Parsea el searchParam `drone` (drone_model_code) a number.
 * Default = null. Validación con regex de dígitos para evitar SQLi
 * si por error el caller lo concatena (no es el caso, pero la
 * defense-in-depth es barata).
 */
export function parseDroneParam(raw: string | null | undefined): number | null {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Builder puro del query string para los filtros. Aislado del
 * componente para que sea fácil testear y para que la lógica de
 * "qué params incluir" esté en un solo lugar.
 *
 * Reglas:
 *   - Solo se incluyen los params que tienen valor no vacío.
 *   - Si después de filtrar no queda nada, devuelve "" (no "?")
 *     para que el "Limpiar filtros" navegue a /map puro.
 *   - El orden es estable: drone, crop, fumigated.
 */
export function buildFiltersQueryString(
  current: URLSearchParams,
  next: { drone: string; crop: string; fumigated: FumigatedFilter }
): string {
  const params = new URLSearchParams(current.toString());
  // Borramos primero para que un "volver a Todos" realmente elimine el param.
  params.delete("drone");
  params.delete("crop");
  params.delete("fumigated");
  if (next.drone) params.set("drone", next.drone);
  if (next.crop) params.set("crop", next.crop);
  if (next.fumigated) params.set("fumigated", next.fumigated);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function MapFilterSidebar({ summary, resultCount }: MapFilterSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deduplicar drones por code, ordenados por nombre. Omitimos code=null
  // porque no se puede filtrar SQL por NULL desde un <select>.
  const droneOptions = useMemo(() => {
    const seen = new Set<number>();
    const out: Array<{ code: number; name: string }> = [];
    for (const row of summary) {
      if (row.drone_model_code === null) continue;
      if (seen.has(row.drone_model_code)) continue;
      seen.add(row.drone_model_code);
      out.push({
        code: row.drone_model_code,
        name: row.drone_model_name ?? `Drone ${row.drone_model_code}`
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return out;
  }, [summary]);

  // Valores actuales desde la URL. Si el param no está, "" = Todos.
  const currentDrone = searchParams.get("drone") ?? "";
  const currentCrop = parseCropParam(searchParams.get("crop"));
  const currentFumigated = parseFumigatedParam(searchParams.get("fumigated"));

  // activeCount por section: 1 si hay filtro, 0 si no. Fumigated:
  // "" (omit) = 0, "yes"/"no" = 1.
  const droneActive = currentDrone ? 1 : 0;
  const cropActive = currentCrop ? 1 : 0;
  const fumigatedActive = currentFumigated ? 1 : 0;

  const navigateWith = useCallback(
    (next: { drone: string; crop: string; fumigated: FumigatedFilter }) => {
      const qs = buildFiltersQueryString(searchParams, next);
      router.push(`/map${qs}`, { scroll: false });
    },
    [router, searchParams]
  );

  const onChangeDrone = (e: React.ChangeEvent<HTMLSelectElement>) => {
    navigateWith({ drone: e.target.value, crop: currentCrop, fumigated: currentFumigated });
  };

  const onChangeCrop = (e: React.ChangeEvent<HTMLSelectElement>) => {
    navigateWith({ drone: currentDrone, crop: e.target.value, fumigated: currentFumigated });
  };

  const onChangeFumigated = (e: React.ChangeEvent<HTMLSelectElement>) => {
    navigateWith({
      drone: currentDrone,
      crop: currentCrop,
      fumigated: parseFumigatedParam(e.target.value)
    });
  };

  // onClear del FilterSidebar: navega a /map sin query string.
  // Es el equivalente del "Limpiar filtros" del v1.3.
  const handleClear = useCallback(() => {
    router.push("/map", { scroll: false });
  }, [router]);

  return (
    <FilterSidebar
      ariaLabel="Filtros del mapa"
      className="h-full"
      clearLabel="Limpiar filtros"
      onClear={handleClear}
      resultCount={resultCount}
      resultLabel="parcelas"
      testId="map-filter-sidebar"
      title="Filtros del mapa"
    >
      <FilterSidebarSection
        activeCount={droneActive}
        count={droneOptions.length}
        testId="map-filter-section-drones"
        title="Drones"
      >
        <select
          aria-label="Filtrar por modelo de drone"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
          data-testid="map-filter-drone"
          id="map-filter-drone"
          onChange={onChangeDrone}
          value={currentDrone}
        >
          <option value="">Todos</option>
          {droneOptions.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </select>
      </FilterSidebarSection>

      <FilterSidebarSection
        activeCount={cropActive}
        count={2}
        testId="map-filter-section-crop"
        title="Cultivo"
      >
        <select
          aria-label="Filtrar por tipo de cultivo"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
          data-testid="map-filter-crop"
          id="map-filter-crop"
          onChange={onChangeCrop}
          value={currentCrop}
        >
          <option value="">Todos</option>
          <option value="Farmland">Farmland</option>
          <option value="Orchards">Orchards</option>
        </select>
      </FilterSidebarSection>

      <FilterSidebarSection
        activeCount={fumigatedActive}
        testId="map-filter-section-fumigated"
        title="Fumigadas (6m)"
      >
        <select
          aria-label="Filtrar por fumigación reciente (últimos 6 meses)"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
          data-testid="map-filter-fumigated"
          id="map-filter-fumigated"
          onChange={onChangeFumigated}
          value={currentFumigated}
        >
          <option value="">Todos</option>
          <option value="yes">Con fumigación</option>
          <option value="no">Sin fumigación</option>
        </select>
      </FilterSidebarSection>
    </FilterSidebar>
  );
}
