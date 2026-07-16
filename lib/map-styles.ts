import type { PathOptions } from "leaflet";

import { COLORS } from "@/lib/ui-tokens";
import type { AlertLevel, DjiParcelRecord } from "@/lib/types";

/**
 * lib/map-styles.ts
 *
 * Single source of truth para los `PathOptions` que el `MapClient` (Leaflet
 * GeoJSON) usa al renderizar polígonos de parcelas y de alertas.
 *
 * Regla del repo: los hex viven en `lib/ui-tokens.ts`. Este archivo los
 * referencia — NUNCA inline. Si necesitas un color nuevo, agregalo a
 * `ui-tokens.ts` y referencialo desde acá.
 *
 * (M3-M5 Track A / 2026-07-15) Commit 2: agrega la distinción visual entre
 * parcelas fumigadas (sólido, fill normal) y no fumigadas (dashed, fill
 * atenuado) más el helper puro `buildFumigatedParcelSet` que la page
 * /map usa para derivar el flag `hasFumigation` por parcela.
 */

export interface ParcelStyleOptions {
  /** Si la parcela está actualmente seleccionada en el panel derecho. */
  isSelected?: boolean;
  /**
   * Si la parcela tiene al menos un evento de fumigación en el rango
   * considerado (típicamente últimos 6 meses). Si se omite, se asume
   * `true` (compatibilidad hacia atrás con callers que no tienen la info).
   *
   *  - `true`  → estilo sólido, sin dashes, fillOpacity "normal".
   *  - `false` → borde dashed (`'4 4'`), fillOpacity 0.15, stroke opacity
   *              reducida — para que la parcela se vea "vacía/pendiente".
   */
  hasFumigation?: boolean;
}

const DEFAULT_STROKE_WEIGHT = 2;
const SELECTED_STROKE_WEIGHT = 4;
const DEFAULT_FILL_OPACITY = 0.35;
const ORCHARD_FILL_OPACITY = 0.25;
const NOT_FUMIGATED_FILL_OPACITY = 0.15;
const ALERT_FILL_OPACITY = 0.35;
const NOT_FUMIGATED_STROKE_OPACITY = 0.45;
const DASH_PATTERN = "4 4";

/**
 * Devuelve el `PathOptions` para un polígono de parcela fumigada.
 *
 * Convenciones:
 *   - Farmland: verde (border `primary` + fill `success`).
 *   - Orchard:  amarillo (border `warning` + fill `warning`) con fill
 *               más tenue para distinguirse visualmente.
 *   - Seleccionada: stroke más grueso (4 vs 2) para feedback inmediato.
 *   - Sin fumigación reciente: borde dashed + fill atenuado.
 *
 * La función es pura — misma entrada, misma salida. Es segura de cachear
 * y de testear sin mocks.
 */
export function getParcelPolygonStyle(
  parcel: DjiParcelRecord,
  options: ParcelStyleOptions = {}
): PathOptions {
  const isOrchard = parcel.is_orchard === true || parcel.field_type === "Orchards";
  const isSelected = options.isSelected === true;
  // Default conservador: si el caller no pasa hasFumigation, asumimos true
  // para no "ocultar" parcelas por accidente.
  const hasFumigation = options.hasFumigation !== false;
  const weight = isSelected ? SELECTED_STROKE_WEIGHT : DEFAULT_STROKE_WEIGHT;

  if (isOrchard) {
    return {
      color: COLORS.warning,
      weight,
      fillColor: COLORS.warning,
      fillOpacity: hasFumigation ? ORCHARD_FILL_OPACITY : NOT_FUMIGATED_FILL_OPACITY,
      ...(hasFumigation ? {} : { dashArray: DASH_PATTERN, opacity: NOT_FUMIGATED_STROKE_OPACITY })
    };
  }

  return {
    color: COLORS.primary,
    weight,
    fillColor: COLORS.success,
    fillOpacity: hasFumigation ? DEFAULT_FILL_OPACITY : NOT_FUMIGATED_FILL_OPACITY,
    ...(hasFumigation ? {} : { dashArray: DASH_PATTERN, opacity: NOT_FUMIGATED_STROKE_OPACITY })
  };
}

/**
 * Devuelve el `PathOptions` para un polígono de alerta, según severidad.
 *
 * Mapeo semántico (alineado con `getStatusTone` en `ui-tokens.ts`):
 *   - HIGH   → `danger`  (rojo)
 *   - MEDIUM → `warning` (amarillo)
 *   - LOW    → `success` (verde)
 *
 * Los tokens se aplican tanto al border como al fill para mantener el
 * mismo criterio visual que el resto del UI (no introducimos hex nuevos).
 */
export function getAlertPolygonStyle(level: AlertLevel): PathOptions {
  if (level === "HIGH") {
    return {
      color: COLORS.danger,
      weight: DEFAULT_STROKE_WEIGHT,
      fillColor: COLORS.danger,
      fillOpacity: ALERT_FILL_OPACITY
    };
  }
  if (level === "MEDIUM") {
    return {
      color: COLORS.warning,
      weight: DEFAULT_STROKE_WEIGHT,
      fillColor: COLORS.warning,
      fillOpacity: ALERT_FILL_OPACITY
    };
  }
  return {
    color: COLORS.success,
    weight: DEFAULT_STROKE_WEIGHT,
    fillColor: COLORS.success,
    fillOpacity: ALERT_FILL_OPACITY
  };
}

/**
 * Input mínimo para `buildFumigatedParcelSet`.
 * Acepta el shape crudo de la BD (`fumigation_date` como string YYYY-MM-DD
 * tras normalización en el boundary) o el `DjiFumigationEvent` completo.
 */
export interface FumigationEventLike {
  parcel_id: number;
  fumigation_date: string | null;
}

/**
 * Función pura: dado un array de eventos de fumigación y una fecha `since`
 * (YYYY-MM-DD, comparada lexicográficamente — funciona porque el formato
 * ISO ordena bien), devuelve un `Set<number>` con los `parcel_id` que
 * tienen al menos una fumigación en el rango `[since, ∞)`.
 *
 * Es la fuente del flag `hasFumigation` que consume `getParcelPolygonStyle`.
 * Se mantiene en `lib/` (puro, sin I/O) para que el caller
 * (`app/map/page.tsx`) la use con cualquier fuente de datos.
 *
 * Diseño:
 *   - Deduplicado por `parcel_id` (un set, no multiset).
 *   - `null` en `fumigation_date` → se ignora (data sucia, no rompe).
 *   - Comparación string es segura para `YYYY-MM-DD`; si en el futuro
 *     llega un ISO con hora, convertir a `YYYY-MM-DD` antes de llamar.
 */
export function buildFumigatedParcelSet(
  events: ReadonlyArray<FumigationEventLike>,
  since: string
): Set<number> {
  const out = new Set<number>();
  for (const e of events) {
    if (!e || e.fumigation_date === null || e.fumigation_date === undefined) continue;
    // Comparación string YYYY-MM-DD funciona lexicográficamente.
    if (e.fumigation_date >= since) {
      out.add(e.parcel_id);
    }
  }
  return out;
}
