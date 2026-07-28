/**
 * lib/map-filter-logic.ts
 *
 * Funciones puras para el filtrado client-side del mapa. Aisladas del
 * componente React para que sean fáciles de testear (mismas reglas que
 * `lib/alerts.ts` y `lib/fumigation-cadence.ts`).
 *
 * Port del patrón del V0
 * (`docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx`).
 * Diferencias con el V0:
 *   - Los `DjiParcelRecord` no traen `client_name`/`farm_name`/
 *     `municipality`/`variety` (esos campos los llena el operador
 *     fumigador en otra tabla). Las funciones relacionadas devuelven
 *     `null` y/o arrays vacíos según corresponda.
 *   - El `events` no tiene `lng`/`lat` propios. Usamos el centroide de
 *     la parcela (computado vía `computeParcelCentroid`).
 *   - El status de cadencia se COMPUTA desde `last_fumigation_date`
 *     con `getFumigationStatus()` (no viene de la BD).
 */

import type { DjiParcelRecord, DjiFumigationEvent } from "@/lib/types";
import { getFumigationStatus, type FumigationStatus } from "@/lib/fumigation-cadence";
import { m2ToHa } from "@/lib/format";
import type {
  CadenceStatus,
  MapFumigationEvent,
  MapFilterState,
  MapKpis,
  MapParcelView
} from "@/lib/map-filter-types";
import { CADENCE_STATUS_META } from "@/lib/map-filter-types";

/** Defaults de cadencia (en días) por tipo de parcela. Espejo de `getDefaultCadence`. */
const CADENCE_DEFAULTS: Record<"Farmland" | "Orchards" | string, number> = {
  Farmland: 14,
  Orchards: 10
};

/** Cadencia usada cuando no hay `field_type` reconocido. */
const FALLBACK_CADENCE_DAYS = 14;

/**
 * Mapea el `FumigationStatus` interno al `CadenceStatus` de UI del V0.
 * Es una proyección 1:1 entre los 4 valores de cada enum (vía el campo
 * `internal` en `CADENCE_STATUS_META`, NO por string-compare del label —
 * los labels son UI-only y pueden cambiar sin que la lógica se entere).
 */
export function toCadenceStatus(s: FumigationStatus): CadenceStatus {
  for (const [cadence, meta] of Object.entries(CADENCE_STATUS_META) as Array<
    [CadenceStatus, (typeof CADENCE_STATUS_META)[CadenceStatus]]
  >) {
    if (meta.internal === s) return cadence;
  }
  // Fallback defensivo. No debería dispararse nunca porque los enums
  // son cerrados, pero si en el futuro se agrega un estado nuevo al
  // FumigationStatus sin actualizar este map, no rompemos la UI.
  return "al_dia";
}

/**
 * Devuelve la cadencia esperada para una parcela.
 *
 * Orden de precedencia (v2.1 — sprint S6.1 / V0 events map):
 *   1. `parcel.recommended_cadence_days` (de `dji_fumigation_schedule`,
 *      LEFT JOIN en `djiParcelsQuery`) si está set y > 0.
 *   2. Default por `field_type` (Farmland=14, Orchards=10).
 *   3. `FALLBACK_CADENCE_DAYS` (14) si el field_type es null o
 *      desconocido.
 *
 * Antes de S6.1 solo existía (2) → (3). La nueva ruta (1) refleja la
 * cadencia OPERATIVA que el supervisor ajusta manualmente (ver
 * `setFumigationCadence` en `api/repositories.ts`) — es la fuente
 * de verdad para "vencida / al día" en el dot de cadencia del mapa.
 */
export function getCadenceDays(parcel: DjiParcelRecord): number {
  const fromSchedule = parcel.recommended_cadence_days;
  if (fromSchedule !== undefined && fromSchedule !== null && fromSchedule > 0) {
    return fromSchedule;
  }
  if (!parcel.field_type) return FALLBACK_CADENCE_DAYS;
  return CADENCE_DEFAULTS[parcel.field_type] ?? FALLBACK_CADENCE_DAYS;
}

/**
 * Calcula el centroide de una parcela. Estrategia:
 *   1. Si hay `reference_point` (Point), usar sus coords directo.
 *   2. Si no, intentar el primer vértice del `spray_geometry` (Polygon o MultiPolygon).
 *   3. Si no hay geometría, devolver `null, null`.
 *
 * No es exactamente el centroide "real" (sería el centro de masa del polígono)
 * pero es suficiente para posicionar markers de eventos en una iteración
 * siguiente. TODO: reemplazar por un centroide de masa si la performance
 * lo permite (1200+ polígonos).
 */
export function computeParcelCentroid(
  parcel: DjiParcelRecord
): { lng: number | null; lat: number | null } {
  const ref = parcel.reference_point;
  if (ref && ref.type === "Point" && Array.isArray(ref.coordinates)) {
    const [lng, lat] = ref.coordinates as number[];
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return { lng, lat };
    }
  }
  const geom = parcel.spray_geometry;
  if (geom) {
    if (geom.type === "Polygon" && Array.isArray(geom.coordinates)) {
      const ring = (geom.coordinates as number[][][])[0];
      if (Array.isArray(ring) && ring.length > 0) {
        const [lng, lat] = ring[0];
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          return { lng, lat };
        }
      }
    } else if (geom.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
      const poly = (geom.coordinates as number[][][][])[0];
      if (Array.isArray(poly) && Array.isArray(poly[0]) && poly[0].length > 0) {
        const [lng, lat] = poly[0][0];
        if (Number.isFinite(lng) && Number.isFinite(lat)) {
          return { lng, lat };
        }
      }
    }
  }
  return { lng: null, lat: null };
}

/**
 * Enriquece un `DjiParcelRecord` al shape `MapParcelView` con su status
 * de cadencia computado y metadata derivada. Mantiene la separación
 * `null` vs "ausente" para que el render del lado UI pueda decidir.
 *
 * v2.1 (sprint S6.1 / V0 events map) — los 4 campos del V0
 * (`client_name`/`farm_name`/`municipality`/`variety`) se proyectan desde
 * el `DjiParcelRecord` extendido (ver `api/queries.ts#djiParcelsQuery`).
 * Mientras el schema no los provea, la query los devuelve como `NULL`
 * y el render del mapa cae a "—" automáticamente — no se rompe nada.
 *
 * `variety` tiene precedencia `parcel.variety ?? parcel.crop_type` para
 * soportar tanto el caso "V0 column directo" como el fallback
 * pragmático al `crop_type` que ya teníamos en S5.
 */
export function toMapParcelView(parcel: DjiParcelRecord): MapParcelView {
  const cadence = getCadenceDays(parcel);
  const internalStatus = getFumigationStatus(parcel.last_fumigation_date, cadence);
  const { lng, lat } = computeParcelCentroid(parcel);
  return {
    id: parcel.id,
    name: parcel.land_name ?? `(Parcela #${parcel.id})`,
    farm_name: parcel.farm_name ?? null,
    client_name: parcel.client_name ?? null,
    municipality: parcel.municipality ?? null,
    variety: parcel.variety ?? parcel.crop_type ?? null,
    area_ha: parcel.declared_area_ha,
    drone_model_code: parcel.drone_model_code,
    drone_model_name: parcel.drone_model_name,
    centroid_lng: lng,
    centroid_lat: lat,
    status: toCadenceStatus(internalStatus),
    last_fumigation_date: parcel.last_fumigation_date ?? null,
    cadence_days: cadence,
    events_in_range: 0,
    ha_in_range: 0
  };
}

/**
 * Convierte un `DjiFumigationEvent` al shape `MapFumigationEvent` que
 * consume el mapa. Asigna `lng`/`lat` del centroide de la parcela.
 *
 * El caller es responsable de pasar el `parcelCentroid` correcto
 * (computado previamente con `computeParcelCentroid`).
 */
export function toMapFumigationEvent(
  event: DjiFumigationEvent,
  parcelCentroid: { lng: number | null; lat: number | null }
): MapFumigationEvent {
  const areaHa = m2ToHa(event.area_fumigated_m2) ?? 0;
  const dose = event.dose_l_per_ha ?? 0;
  const volume = areaHa * dose;
  const flights = event.flight_ids?.length ?? 0;
  return {
    id: event.id,
    parcel_id: event.parcel_id,
    executed_at: event.fumigation_date,
    source: event.source,
    area_treated_ha: areaHa,
    volume_l: volume,
    flights_count: flights,
    lng: parcelCentroid.lng,
    lat: parcelCentroid.lat
  };
}

/**
 * Devuelve el set único de `client_name`/`farm_name` (cualquier string
 * truthy) presentes en la lista de parcelas. Si no hay parcels con
 * esos campos, devuelve un array vacío.
 */
export function uniqueClients(parcels: MapParcelView[]): string[] {
  const set = new Set<string>();
  for (const p of parcels) {
    if (p.client_name) set.add(p.client_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

export function uniqueFarms(parcels: MapParcelView[], client: string): string[] {
  const set = new Set<string>();
  for (const p of parcels) {
    if (!p.farm_name) continue;
    if (client !== "todos" && p.client_name !== client) continue;
    set.add(p.farm_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/**
 * Filtra `parcels` por el `MapFilterState`. Aplica los filtros en
 * orden: client → farm → model → statuses → query. Si un eje no tiene
 * datos (e.g. `client_name` es null en todos los parcels), el filtro
 * se vuelve no-op (no restringe).
 */
export function applyParcelFilters(
  parcels: MapParcelView[],
  filters: MapFilterState
): MapParcelView[] {
  const q = filters.query.trim().toLowerCase();
  return parcels.filter((p) => {
    if (filters.client !== "todos" && p.client_name !== filters.client) return false;
    if (filters.farm !== "todas" && p.farm_name !== filters.farm) return false;
    if (
      filters.model !== "todos" &&
      p.drone_model_code !== null &&
      String(p.drone_model_code) !== filters.model
    ) {
      return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(p.status)) return false;
    if (q) {
      // Fuzzy sobre name + farm + client + municipality + variety + id.
      // Cualquier campo null se omite (no aparece en el haystack).
      const hay = [
        p.name,
        p.farm_name,
        p.client_name,
        p.municipality,
        p.variety,
        String(p.id)
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Filtra `events` por (a) pertenencia a un set de `parcelIds`,
 * (b) pertenencia a la lista de `sources` activos, (c) rango temporal
 * `[from, to]` donde `from`/`to` son timestamps epoch ms.
 *
 * El set de `parcelIds` se pasa como argumento (no se deriva adentro)
 * para que el caller lo compute una sola vez con el resultado de
 * `applyParcelFilters` y lo reuse entre los useMemo.
 */
export function applyEventFilters(
  events: MapFumigationEvent[],
  parcelIds: Set<number>,
  sources: MapFumigationEvent["source"][],
  from: number,
  to: number
): MapFumigationEvent[] {
  return events.filter((e) => {
    if (!parcelIds.has(e.parcel_id)) return false;
    if (sources.length > 0 && !sources.includes(e.source)) return false;
    // `executed_at` es YYYY-MM-DD → convertimos a epoch ms UTC midnight.
    const t = Date.UTC(
      Number(e.executed_at.slice(0, 4)),
      Number(e.executed_at.slice(5, 7)) - 1,
      Number(e.executed_at.slice(8, 10))
    );
    return t >= from && t <= to;
  });
}

/**
 * Construye un `Map<parcelId, { count, ha, volume, flights, last }>`
 * agreg sobre los eventos. La clave de agregación es `parcel_id`. El
 * caller lo usa para pintar el `events_in_range` en el rail derecho y
 * para ordenar la lista.
 */
export function aggregateEventsByParcel(
  events: MapFumigationEvent[]
): Map<number, { count: number; ha: number; volume: number; flights: number; last: string | null }> {
  const map = new Map<
    number,
    { count: number; ha: number; volume: number; flights: number; last: string | null }
  >();
  for (const e of events) {
    const cur = map.get(e.parcel_id) ?? {
      count: 0,
      ha: 0,
      volume: 0,
      flights: 0,
      last: null
    };
    cur.count += 1;
    cur.ha += e.area_treated_ha;
    cur.volume += e.volume_l;
    cur.flights += e.flights_count;
    if (!cur.last || e.executed_at > cur.last) cur.last = e.executed_at;
    map.set(e.parcel_id, cur);
  }
  return map;
}

/**
 * Enriquece cada `MapParcelView` con su `events_in_range` y `ha_in_range`
 * a partir del aggregate. Devuelve un nuevo array (no muta).
 */
export function decorateParcelsWithEvents(
  parcels: MapParcelView[],
  eventsByParcel: ReturnType<typeof aggregateEventsByParcel>
): MapParcelView[] {
  return parcels.map((p) => {
    const agg = eventsByParcel.get(p.id);
    return {
      ...p,
      events_in_range: agg?.count ?? 0,
      ha_in_range: agg ? Math.round(agg.ha * 10) / 10 : 0
    };
  });
}

/**
 * Calcula los KPIs agregados sobre el set de eventos filtrados.
 */
export function computeKpis(
  events: MapFumigationEvent[],
  eventsByParcel: ReturnType<typeof aggregateEventsByParcel>
): MapKpis {
  let ha = 0;
  let volume = 0;
  let flights = 0;
  for (const e of events) {
    ha += e.area_treated_ha;
    volume += e.volume_l;
    flights += e.flights_count;
  }
  return {
    events: events.length,
    ha: Math.round(ha * 10) / 10,
    volume: Math.round(volume * 10) / 10,
    flights,
    parcels: eventsByParcel.size
  };
}

/**
 * Ordena parcelas por (a) status de cadencia (más urgente primero),
 * (b) `events_in_range` desc. Patrón idéntico al V0.
 */
export function sortParcelsByPriority(
  parcels: MapParcelView[],
  order: readonly CadenceStatus[]
): MapParcelView[] {
  return [...parcels].sort((a, b) => {
    const sa = order.indexOf(a.status);
    const sb = order.indexOf(b.status);
    if (sa !== sb) return sa - sb;
    return b.events_in_range - a.events_in_range;
  });
}

/**
 * Inicializa el `MapFilterState` con los defaults. Aislado para que
 * el componente y los tests compartan exactamente los mismos valores
 * iniciales.
 */
export function defaultFilterState(): MapFilterState {
  return {
    client: "todos",
    farm: "todas",
    model: "todos",
    statuses: [],
    sources: [],
    query: ""
  };
}
