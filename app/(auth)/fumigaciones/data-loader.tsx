/**
 * `FumigacionesDataLoader` — Sprint Fase 2 / Q1 (2026-08-23).
 *
 * Server component que llama `getRecentFumigations(2000)` UNA SOLA VEZ
 * y pasa el array a su `children` (render prop). Reemplaza el patrón
 * anterior donde `FumigacionesCounts` y `FumigacionesTable` hacían
 * cada uno su propio `getRecentFumigations(2000)`, lo cual
 * disparaba 2 round-trips al cache `afm:recent-fumigations` por
 * render (uno por componente, dentro de su propio `<Suspense>`).
 *
 * Diseño:
 *   - El array de fumigaciones es INMUTABLE dentro de un render
 *     (los filtros aplicados por Table son server-side, en memoria
 *     sobre `events`). No hay race conditions.
 *   - Recibe los filtros como props (no los usa para nada — son
 *     "dummy" para que React Server Components pueda detectar
 *     cambios y re-renderizar el Loader). Sin esto, si los filtros
 *     cambian pero el Loader no se re-monta, Table recibiría la
 *     lista cacheada del fetch anterior.
 *   - El componente padre envuelve el Loader en `<Suspense>` para
 *     preservar la UX de loading (skeleton mientras se trae el array).
 *
 * Tests:
 *   - `tests/app-fumigaciones-data-loader.test.ts` verifica que el
 *     Loader llama `getRecentFumigations` UNA sola vez (no 2) y
 *     que `children` recibe el array.
 */

import type { ReactNode } from "react";
import { getRecentFumigations } from "@/api/repositories";
import type { DjiFumigationEvent } from "@/lib/types";

/**
 * SearchParams crudos que el padre pasa al Loader. Solo se usan
 * para forzar re-mount cuando cambian (mismo patrón que
 * `unstable_cache` keys). No se aplican acá — el filtrado real
 * lo hace el componente que recibe `events` (usualmente Table).
 */
export type LoaderSearchParams = Record<string, string | string[] | undefined>;

export interface FumigacionesDataLoaderProps {
  /**
   * Render prop: recibe el array compartido y devuelve el árbol
   * que se rendereará dentro del Loader. Esto permite que Counts
   * y Table ambos usen el mismo array sin doble fetch.
   */
  children: (events: DjiFumigationEvent[]) => ReactNode;
  /**
   * Filtro de fuente (djiscraper | import | manual | null). Solo
   * se usa para forzar re-mount cuando cambia.
   */
  sourceFilter: "djiscraper" | "import" | "manual" | null;
  /** Query de búsqueda. Solo para forzar re-mount. */
  query?: string;
  /** Filtro de categoría curada (id o null). Solo para re-mount. */
  categoryFilter?: number | null;
  /** Fecha inicio (YYYY-MM-DD o null). Solo para re-mount. */
  fromDate?: string | null;
  /** Fecha fin (YYYY-MM-DD o null). Solo para re-mount. */
  toDate?: string | null;
  /** Filtro de parcela específica. Solo para re-mount. */
  parcelFilter?: number | null;
  /** Filtro de dron. Solo para re-mount. */
  droneFilter?: number | null;
  /** Página actual. Solo para re-mount. */
  page?: number;
  /** SearchParams crudos (para Pagination). Solo para re-mount. */
  rawSearchParams?: LoaderSearchParams;
}

/**
 * Server component que trae el array de fumigaciones y lo pasa a
 * su `children`. Ver docstring arriba.
 */
export async function FumigacionesDataLoader({
  children,
  // Las props "dummy" se aceptan para que React detecte cambios y
  // re-monte el componente (lo que re-dispara el fetch). Se marcan
  // con underscore para silenciar el linter de "unused".
  sourceFilter: _sourceFilter,
  query: _query,
  categoryFilter: _categoryFilter,
  fromDate: _fromDate,
  toDate: _toDate,
  parcelFilter: _parcelFilter,
  droneFilter: _droneFilter,
  page: _page,
  rawSearchParams: _rawSearchParams
}: FumigacionesDataLoaderProps) {
  const events = await getRecentFumigations(2000);
  return <>{children(events)}</>;
}
