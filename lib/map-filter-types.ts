/**
 * lib/map-filter-types.ts
 *
 * Tipos compartidos entre `map-page-client.tsx` y la lógica de filtros
 * client-side del mapa. Aislados del componente React para que sean
 * fáciles de testear sin un DOM.
 *
 * Contexto: en el sprint S5 / S6 portamos la lógica del V0
 * (`docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx`)
 * al MapPageClient actual. El V0 trabajaba sobre un payload plano con
 * client_name/farm_name/municipality/variety explícitos por parcela. Nuestro
 * `DjiParcelRecord` NO tiene esos campos — el operador fumigador los llena
 * a mano en otra parte. Para no bloquear el port, los derivados se exponen
 * como "best-effort": si el campo no existe, el filtro simplemente no
 * restringe por ese eje (y el caller marca TODO en su render).
 */

/**
 * Estado de cadencia EXPUESTO en la UI. Mapeo desde el `FumigationStatus`
 * interno (lib/fumigation-cadence.ts) a las 4 etiquetas del V0:
 *
 *   - `critico`      → `no_history` (sin fumigación registrada, alto riesgo)
 *   - `vencido`      → `overdue` (pasó la fecha objetivo)
 *   - `por_vencer`   → `due_soon` (vence en ≤ 7 días)
 *   - `al_dia`       → `ok` (todavía en fecha)
 *
 * Esta es la nomenclatura visible al operador. La interna
 * (`FumigationStatus`) se mantiene en `lib/fumigation-cadence.ts` y se
 * computa vía `getFumigationStatus()`.
 */
export type CadenceStatus = "critico" | "vencido" | "por_vencer" | "al_dia";

/** Orden canónico de cadencia (más urgente primero). */
export const CADENCE_STATUS_ORDER: readonly CadenceStatus[] = [
  "critico",
  "vencido",
  "por_vencer",
  "al_dia"
] as const;

/** Mapa de cadencia → metadata de UI (label + color). */
export const CADENCE_STATUS_META: Record<
  CadenceStatus,
  { label: string; color: string; /** status interno equivalente. */ internal: "no_history" | "overdue" | "due_soon" | "ok" }
> = {
  critico: { label: "Crítico", color: "#a93232", internal: "no_history" },
  vencido: { label: "Vencido", color: "#c7a43a", internal: "overdue" },
  por_vencer: { label: "Por vencer", color: "#16847e", internal: "due_soon" },
  al_dia: { label: "Al día", color: "#2c7f44", internal: "ok" }
};

/**
 * Estado del mapa base. V0 usa "satelite" | "calles"; nuestro MapLibreView
 * usa "satellite" | "streets" (inglés). Exponemos el contrato del V0 y
 * mapeamos al pasar al MapLibreView.
 */

/**
 * Source/origen de un registro de fumigación. Espejo del campo
 * `DjiFumigationEvent.source` pero declarado localmente para que
 * `lib/map-filter-logic.ts` no tenga que importar tipos de BD.
 */
export type FumigationSource = "manual" | "djiscraper" | "import";

/** Filtros cuyo estado vive 100% en el cliente. */
export interface MapFilterState {
  /** "todos" = sin filtro. */
  client: string;
  /** "todas" = sin filtro. Se resetea a "todas" cuando cambia `client`. */
  farm: string;
  /** "todos" = sin filtro. */
  model: string;
  /** Lista de cadencia activa (OR entre ellas). Vacío = sin filtro. */
  statuses: CadenceStatus[];
  /** Lista de source activa (OR entre ellas). Vacío = sin filtro. */
  sources: FumigationSource[];
  /** Búsqueda libre sobre name/farm/client/municipality/variety/id. */
  query: string;
}

/** Estado del rango temporal (en meses, no en fechas). */
/** Estado de visibilidad de capas. */

/**
 * Parcela enriquecida con los datos que el V0 expone al `<MapParcel>`.
 * Donde nuestro `DjiParcelRecord` no tiene el campo, marcamos `null` y
 * emitimos un TODO en el render (ver `map-page-client.tsx`).
 */
export interface MapParcelView {
  id: number;
  name: string;
  /** TODO: DjiParcelRecord no tiene `farm_name`. */
  farm_name: string | null;
  /** TODO: DjiParcelRecord no tiene `client_name`. */
  client_name: string | null;
  /** TODO: DjiParcelRecord no tiene `municipality`. */
  municipality: string | null;
  /** TODO: DjiParcelRecord no tiene `variety`; mapeamos a `crop_type` si existe. */
  variety: string | null;
  area_ha: number | null;
  /** Modelo de dron (código numérico, no ID). */
  drone_model_code: number | null;
  drone_model_name: string | null;
  centroid_lng: number | null;
  centroid_lat: number | null;
  status: CadenceStatus;
  /** YYYY-MM-DD. */
  last_fumigation_date: string | null;
  /** Default 14 si no hay schedule. */
  cadence_days: number;
  /** Cantidad de eventos que caen en el rango activo. */
  events_in_range: number;
  /** Hectáreas tratadas en el rango activo (suma de area_fumigated_m2 / 10000). */
  ha_in_range: number;
}

/**
 * Event-shape mínimo para renderizar en el mapa y para el filtrado
 * client-side. Deriva de `DjiFumigationEvent` pero reduce las columnas
 * a lo que la UI efectivamente consume.
 */
export interface MapFumigationEvent {
  id: number;
  parcel_id: number;
  /** YYYY-MM-DD. */
  executed_at: string;
  source: FumigationSource;
  area_treated_ha: number;
  /**
   * Calculado: `area_fumigated_m2 / 10000 * dose_l_per_ha` si ambos
   * están disponibles. Si no, 0. El caller puede renderizar "—".
   */
  volume_l: number;
  /** Calculado: `flight_ids?.length ?? 0`. */
  flights_count: number;
  /** lng/lat del centroide de la parcela (los eventos no tienen coords propias). */
  lng: number | null;
  lat: number | null;
}

/**
 * Kpis derivados del set filtrado de eventos. Es el shape que
 * consume el `KpiPill` existente.
 */
export interface MapKpis {
  events: number;
  ha: number;
  volume: number;
  flights: number;
  /** Cantidad de parcelas distintas con al menos 1 evento en el rango. */
  parcels: number;
}

/** Estado completo del componente. Útil para tests y serialización. */

