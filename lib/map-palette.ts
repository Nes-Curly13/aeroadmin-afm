/**
 * lib/map-palette.ts — paleta única de la simbología de mapas (Geovisor,
 * parcelas, fumigaciones).
 *
 * UI-T2 (auditoría UI 2026-09-21): antes los hex de la simbología estaban
 * dispersos en `geo-map.tsx`, `parcel-map.tsx`, `fumigation-map.tsx`,
 * `parcel-map-picker.tsx` y la leyenda del `geovisor-client.tsx`, con
 * riesgo de drift entre el mapa y su leyenda.
 *
 * MapLibre no puede leer variables CSS en `paint` (necesita valores
 * concretos), así que centralizamos los literales acá y los consumimos
 * desde un solo lugar. Los colores semánticos de la UI (warning, orphan
 * en chips/banners) sí viven como tokens CSS en `app/globals.css`.
 */
export const MAP_COLORS = {
  /** Polígono de parcela (naranja/ámbar). */
  parcel: "#f59e0b",
  /** Borde del polígono de parcela (ámbar oscuro). */
  parcelLine: "#b45309",
  /** Parcela seleccionada (azul). */
  parcelSelected: "#2563eb",
  /** Aplicación/fumigación (cian). */
  event: "#06b6d4",
  /** Borde del hull de una aplicación (cian oscuro). */
  eventLine: "#0891b2",
  /** Fumigación huérfana, sin parcela (morado). */
  orphan: "#a855f7",
  /** Borde punteado de una huérfana (morado oscuro). */
  orphanLine: "#7e22ce",
  /** Amarillo de marca AFM (marcadores puntuales). */
  brandLime: "#f5e839",
  /** Tinta oscura (bordes de marcadores). */
  ink: "#1f2937",
  /** Blanco (texto/interior de marcadores). */
  white: "#ffffff",
  /** Verde de parcela primaria (relleno). */
  primaryFill: "#16a34a",
  /** Verde claro de parcela secundaria (relleno). */
  secondaryFill: "#86efac",
  /** Verde de parcela primaria (línea). */
  primaryLine: "#15803d",
  /** Verde claro de parcela secundaria (línea). */
  secondaryLine: "#22c55e"
} as const;
