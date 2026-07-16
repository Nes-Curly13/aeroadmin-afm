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
 * (M3-M5 Track A / 2026-07-15) Esta es la versión inicial (commit 1). El
 * commit 2 va a agregar la distinción fumigado/no-fumigado (dashed + menor
 * fillOpacity) sin cambiar la firma básica.
 */

export interface ParcelStyleOptions {
  /** Si la parcela está actualmente seleccionada en el panel derecho. */
  isSelected?: boolean;
}

const DEFAULT_STROKE_WEIGHT = 2;
const SELECTED_STROKE_WEIGHT = 4;
const DEFAULT_FILL_OPACITY = 0.35;
const ORCHARD_FILL_OPACITY = 0.25;
const ALERT_FILL_OPACITY = 0.35;

/**
 * Devuelve el `PathOptions` para un polígono de parcela fumigada.
 *
 * Convenciones:
 *   - Farmland: verde (border `primary` + fill `success`).
 *   - Orchard:  amarillo (border `warning` + fill `warning`) con fill
 *               más tenue para distinguirse visualmente.
 *   - Seleccionada: stroke más grueso (4 vs 2) para feedback inmediato.
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

  if (isOrchard) {
    return {
      color: COLORS.warning,
      weight: isSelected ? SELECTED_STROKE_WEIGHT : DEFAULT_STROKE_WEIGHT,
      fillColor: COLORS.warning,
      fillOpacity: ORCHARD_FILL_OPACITY
    };
  }

  return {
    color: COLORS.primary,
    weight: isSelected ? SELECTED_STROKE_WEIGHT : DEFAULT_STROKE_WEIGHT,
    fillColor: COLORS.success,
    fillOpacity: DEFAULT_FILL_OPACITY
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
