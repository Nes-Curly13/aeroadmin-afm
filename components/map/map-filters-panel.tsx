"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import type { getParcelsSummary } from "@/api/repositories";

/**
 * components/map/map-filters-panel.tsx
 *
 * v1.3 Track A — panel de filtros avanzados del mapa.
 *
 * Auditoría ui-ux-2026-07 §10 (🟠 ALTA): el mapa mostraba TODO o nada.
 * El supervisor con 200 parcelas no podía filtrar por drone / crop /
 * fumigación reciente. Este panel agrega 3 filtros server-side via
 * URL searchParams (drone, crop, fumigated).
 *
 * Decisiones de diseño:
 *   1. **Filtros = URL searchParams** (no estado local). Permite
 *      compartir filtros por link, navegar con back/forward, y la
 *      página es server-rendered: el filtro se aplica en el SQL antes
 *      de mandar los polígonos al cliente.
 *   2. **`<form>` con `router.push()` y `scroll: false`**: el form
 *      permite submit con Enter (a11y) pero el handler intercepta
 *      el submit y los cambios de select para no hacer full reload.
 *   3. **`scroll: false`**: el mapa del operador puede tener mucho
 *      zoom/pan. Al cambiar filtro, no queremos que la página
 *      salte al top.
 *   4. **Deduplicar drones por `drone_model_code`**: `getParcelsSummary`
 *      agrupa por (code, name); si hay lotes con el mismo code pero
 *      nombres distintos, solo dejamos el primero.
 *   5. **Omitir drones con `code` null**: no se puede filtrar SQL por
 *      NULL desde un <select> con value="" — se filtra client-side.
 *   6. **Limpiar = navega a /map** (sin query string). El botón
 *      "Limpiar filtros" borra TODOS los filtros de una.
 *   7. **No tocar `map-view.tsx` ni `map-client.tsx`**: los polígonos
 *      ya vienen filtrados del server (getParcelsNormalized con
 *      filter={droneModelCode, fieldType}). El cliente no sabe que
 *      hubo filtro — la abstracción es transparente.
 */

type ParcelsSummaryRow = Awaited<ReturnType<typeof getParcelsSummary>>[number];

export interface MapFiltersPanelProps {
  /**
   * Filas del summary de parcelas (mismo shape que `MapStatsIsland`).
   * Se usa SOLO para derivar la lista única de `drone_model_code` +
   * `drone_model_name` que aparece en el select de "Drone". El panel
   * NO recalcula KPIs ni totales — eso es responsabilidad del island.
   */
  summary: ParcelsSummaryRow[];
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

export function MapFiltersPanel({ summary }: MapFiltersPanelProps) {
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

  const onClearFilters = () => {
    // Navegamos a /map puro. router.push con path solo = strip query.
    router.push("/map", { scroll: false });
  };

  // Detectamos "hay filtros activos" para mostrar el botón "Limpiar"
  // de forma más prominente (y no confundir al usuario).
  const hasActiveFilters = Boolean(currentDrone || currentCrop || currentFumigated);

  return (
    <form
      aria-label="Filtros del mapa"
      className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-[#d2ddd6] bg-white p-4 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="map-filters-panel"
      // El form permite submit con Enter, pero como cada select navega
      // onChange, no necesitamos un botón "Aplicar". onSubmit vacío
      // evita un POST accidental al URL actual.
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]"
          htmlFor="map-filter-drone"
        >
          Drone
        </label>
        <select
          aria-label="Filtrar por modelo de drone"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
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
      </div>

      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]"
          htmlFor="map-filter-crop"
        >
          Cultivo
        </label>
        <select
          aria-label="Filtrar por tipo de cultivo"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
          id="map-filter-crop"
          onChange={onChangeCrop}
          value={currentCrop}
        >
          <option value="">Todos</option>
          <option value="Farmland">Farmland</option>
          <option value="Orchards">Orchards</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#587064]"
          htmlFor="map-filter-fumigated"
        >
          Fumigación reciente
        </label>
        <select
          aria-label="Filtrar por fumigación reciente (últimos 6 meses)"
          className="rounded-lg border border-[#cfd8d3] bg-white px-3 py-2 text-sm font-semibold text-[#121815] focus:border-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/30"
          id="map-filter-fumigated"
          onChange={onChangeFumigated}
          value={currentFumigated}
        >
          <option value="">Todos</option>
          <option value="yes">Con fumigación</option>
          <option value="no">Sin fumigación</option>
        </select>
      </div>

      <button
        className={
          "rounded-full px-4 py-2 text-sm font-semibold transition " +
          (hasActiveFilters
            ? "bg-[#0b5f2d] text-white hover:bg-[#0a4f25]"
            : "border border-[#cfd8d3] bg-white text-[#4a5b50] hover:bg-[#f4f7f4]")
        }
        disabled={!hasActiveFilters}
        onClick={onClearFilters}
        type="button"
      >
        Limpiar filtros
      </button>
    </form>
  );
}
