// lib/flight-plan-styles.ts
//
// M3-M5 Track B (2026-07-17): PathOptions de Leaflet para la capa
// "Planes de vuelo" (Polyline) que renderiza la geometría del plan
// DJI como polilínea dashed sobre el mapa.
//
// Por qué un archivo separado de `lib/map-styles.ts` (Track A owns):
//   - `map-styles.ts` centraliza estilos de POLÍGONOS (parcelas, alertas).
//   - `flight-plan-styles.ts` centraliza estilos de LÍNEAS (planes DJI).
//   - El shape semántico es distinto: polígonos = fumigación real
//     (sólido, color por estado), líneas = plan/intención (dashed,
//     color cyan/teal para distinguir).
//
// Regla del repo: los hex viven en `lib/ui-tokens.ts`. Este archivo
// los referencia — NUNCA inline.

import type { PathOptions } from "leaflet";

import { COLORS } from "@/lib/ui-tokens";

export interface FlightPlanStyleOptions {
  /** Si el plan corresponde a la parcela actualmente seleccionada
   * en el panel derecho. Default: false. */
  isSelected?: boolean;
}

const DEFAULT_STROKE_WEIGHT = 2;
const SELECTED_STROKE_WEIGHT = 3;
const DEFAULT_OPACITY = 0.7;
const DASH_PATTERN = "6 4";

/**
 * Devuelve el `PathOptions` para una polilínea de plan de vuelo DJI.
 *
 * Convenciones visuales:
 *   - Stroke color `info` (cyan/teal): tono distinto de los verdes
 *     de fumigación real, indica "plan, no ejecución".
 *   - `dashArray: "6 4"`: línea punteada que refuerza la idea de
 *     "trayectoria planeada" vs "área fumigada sólida".
 *   - Opacity 0.7: suficientemente visible sin tapar capas inferiores.
 *   - `isSelected`: weight sube a 3 para feedback inmediato.
 *
 * La función es pura — misma entrada, misma salida. Es segura de
 * cachear y de testear sin mocks.
 */
export function getFlightPlanStyle(options: FlightPlanStyleOptions = {}): PathOptions {
  const isSelected = options.isSelected === true;
  return {
    color: COLORS.info,
    weight: isSelected ? SELECTED_STROKE_WEIGHT : DEFAULT_STROKE_WEIGHT,
    opacity: DEFAULT_OPACITY,
    dashArray: DASH_PATTERN
  };
}
