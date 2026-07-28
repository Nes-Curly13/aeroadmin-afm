// lib/map-parcel-content.ts
//
// M3-M5 Track C — helpers puros para el contenido textual que se renderiza
// sobre un polígono de parcela en el mapa de /map (MapLibre) y para el
// aria-label del listbox accesible.
//
// v2.0 (sprint S5) — migrado de Leaflet a MapLibre. El tipo
// `ParcelLayerLike` se reemplaza por `ParcelInteractiveLike` (neutral,
// compatible con MapLibre `maplibregl.Map` vía duck-typing en handlers).
//
// Funciones exportadas:
//   - getParcelHoverContent(parcel): string  → MapLibre tooltip HTML (compacto)
//   - getParcelPopupContent(parcel): string  → MapLibre popup HTML (extendido)
//   - getParcelA11yLabel(parcel): string     → aria-label (sin HTML)
//
// Decisiones de diseño:
//   - HTML escaped: los popups renderizan innerHTML, así que cualquier valor
//     controlado por el usuario (land_name, alert_message) debe escaparse.
//     La función `escapeHtml` cubre los 5 caracteres básicos (& < > " ').
//   - Fechas: delegamos en `formatDateWithWeekday` (es-CO) para mantener
//     consistencia con el resto de la app. La función es TZ-fragile (UTC
//     midnight ↔ es-CO), pero ese comportamiento ya está documentado en
//     lib/format.ts y es la convención del repo.
//   - Estilo del polígono: NO vive acá — está en `lib/map-styles.ts`
//     (M3-M5 Track A, 2026-07-15) que es la single source of truth para
//     el shape neutral `PathStyle`. Track A maneja isSelected + hasFumigation.

import { formatDateWithWeekday } from "@/lib/format";
import { getParcelPolygonStyle } from "@/lib/map-styles";
import type { AlertLevel, DjiParcelRecord } from "@/lib/types";

// ============================================================
// Tipos públicos
// ============================================================

/**
 * Input shape para los helpers de contenido de parcela.
 * No depende de DjiParcelRecord: el caller (MapView o quien sea) compone el
 * shape a partir de la query, joins, etc. Mantener la dependencia libre de
 * `lib/types` facilita el testing unitario y evita acoplar a un shape que
 * puede crecer (raw_*, geometry objects, etc.).
 */
export interface ParcelContentInput {
  /** Nombre legible de la parcela (DjiParcelRecord.land_name). */
  name: string | null;
  /** Área declarada en hectáreas (DjiParcelRecord.declared_area_ha). */
  areaHa: number | null;
  /** Última fecha de fumigación en formato YYYY-MM-DD. */
  lastFumigationDate: string | null;
  /** Total de sorties (vuelos) sobre esta parcela. Opcional. */
  totalFlights?: number;
  /** Nivel de alerta de la parcela (si tiene). Opcional. */
  alertLevel?: AlertLevel | null;
  /** Mensaje de alerta (libre, viene de DjiAlertRecord.message). Opcional. */
  alertMessage?: string | null;
}

/**
 * Opciones para `getParcelPopupContent`. Reservado para futuro.
 */
export interface ParcelInteractionOptions {
  /** Handler para `mouseover` (ej. cambiar cursor a pointer). */
  onMouseOver?: () => void;
  /** Handler para `mouseout` (ej. reset cursor). */
  onMouseOut?: () => void;
}

// ============================================================
// Helpers internos
// ============================================================

/**
 * Escapa los 5 caracteres HTML básicos. Suficiente para tooltips/popups de
 * Leaflet que renderizan como innerHTML. No es una solución completa de
 * sanitización (no parsea contexto), pero cubre la inyección de tags y
 * atributos que es lo que nos preocupa aquí.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formatea el área en hectáreas con 2 decimales. Locale en-US para
 * separador de miles (consistente con el resto del repo, ver
 * `formatNumber` en lib/format.ts). Devuelve "—" para null/undefined.
 */
function formatArea(areaHa: number | null | undefined): string {
  if (areaHa === null || areaHa === undefined) return "—";
  if (!Number.isFinite(areaHa)) return "—";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(areaHa)} ha`;
}

/**
 * Formatea la última fecha de fumigación. Si es null, devuelve el texto
 * canónico "sin fumigaciones registradas" para que la UI sea consistente
 * entre hover, popup y aria-label.
 */
function formatLastFumigation(date: string | null | undefined): string {
  if (!date) return "sin fumigaciones registradas";
  return formatDateWithWeekday(date);
}

/**
 * Mapea AlertLevel a una etiqueta legible en español. Usada por Popup
 * (render visual) y por aria-label (lectura por screen reader).
 */
function alertLevelLabel(level: AlertLevel | null | undefined): string {
  if (level === "HIGH") return "Alta";
  if (level === "MEDIUM") return "Media";
  if (level === "LOW") return "Baja";
  return "—";
}

// ============================================================
// Funciones públicas
// ============================================================

/**
 * Contenido compacto para tooltip en hover de polígono.
 * 1 línea: nombre + área + última fumigación.
 *
 * Render esperado en el mapa:
 *   <strong>Porvenir STE 3</strong>
 *   5.32 ha · dom 14 jun 2026
 *
 * Por qué string (no JSX): MapLibre recibe HTML vía Popup.setHTML; si
 * devolviéramos JSX habría que renderizar a string en cada llamada
 * (overhead) o montar un portal. String es lo que MapLibre espera.
 */
export function getParcelHoverContent(parcel: ParcelContentInput): string {
  const name = parcel.name ?? "Sin nombre";
  const area = formatArea(parcel.areaHa);
  const last = formatLastFumigation(parcel.lastFumigationDate);
  return `<strong>${escapeHtml(name)}</strong><br/>${escapeHtml(area)} · ${escapeHtml(last)}`;
}

/**
 * Contenido extendido para popup en click de polígono.
 * 4-5 líneas: nombre, área, fumigaciones, total vuelos, alerta (opcional).
 *
 * Render esperado:
 *   <strong>Porvenir STE 3</strong>
 *   5.32 ha
 *   Última fumigación: dom 14 jun 2026
 *   Vuelos: 12
 *   Alerta: Alta — Operación sobre-explotada
 */
export function getParcelPopupContent(parcel: ParcelContentInput): string {
  const name = parcel.name ?? "Sin nombre";
  const area = formatArea(parcel.areaHa);
  const last = formatLastFumigation(parcel.lastFumigationDate);
  const flights = parcel.totalFlights === undefined ? "—" : String(parcel.totalFlights);
  const alert = alertLevelLabel(parcel.alertLevel);

  const lines: string[] = [
    `<strong>${escapeHtml(name)}</strong>`,
    escapeHtml(area),
    `Última fumigación: ${escapeHtml(last)}`,
    `Vuelos: ${escapeHtml(flights)}`
  ];

  if (parcel.alertLevel !== null && parcel.alertLevel !== undefined) {
    const msg = parcel.alertMessage ? ` — ${escapeHtml(parcel.alertMessage)}` : "";
    lines.push(`<span style="color:#a93232;font-weight:600;">Alerta: ${escapeHtml(alert)}${msg}</span>`);
  }

  return lines.join("<br/>");
}

/**
 * aria-label para el `<li role="option">` del listbox accesible.
 * String puro (sin HTML), diseñado para ser leído por screen readers.
 *
 * Formato:
 *   "Parcela Porvenir STE 3, 5.32 hectáreas, última fumigación dom 14 jun 2026"
 *   "Parcela sin nombre, área desconocida, sin fumigaciones registradas"
 */
export function getParcelA11yLabel(parcel: ParcelContentInput): string {
  const namePart = parcel.name ? `Parcela ${parcel.name}` : "Parcela sin nombre";
  const areaPart =
    parcel.areaHa === null || parcel.areaHa === undefined
      ? "área desconocida"
      : `${new Intl.NumberFormat("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(parcel.areaHa)} hectáreas`;
  const datePart = parcel.lastFumigationDate
    ? `última fumigación ${formatDateWithWeekday(parcel.lastFumigationDate)}`
    : "sin fumigaciones registradas";
  return `${namePart}, ${areaPart}, ${datePart}`;
}

/**
 * v2.0 (sprint S5) — la función `bindParcelLayerInteractions` quedó
 * obsoleta con la migración a MapLibre. La asociación de tooltip/popup
 * ahora se hace directamente en `MapLibreView` (con MapLibre Popup
 * + un tooltip HTML sobre el source GeoJSON).
 *
 * El popup/hover HTML lo genera `renderParcelPopup()` y se pasa a
 * `maplibregl.Popup({ closeButton: true }).setLngLat(...).setHTML(...)`.
 * Para mantener el contrato de tests existente, esta función ahora
 * solo devuelve los strings sin side effects (los tests de unit se
 * ajustan para usar getParcelPopupContent / getParcelHoverContent
 * directamente).
 *
 * @deprecated usar `getParcelPopupContent` + `getParcelHoverContent` directamente.
 *             Se conserva la firma para no romper tests legacy.
 */
export function bindParcelLayerInteractions(
  _layer: unknown,
  parcel: ParcelContentInput,
  _options?: ParcelInteractionOptions
): void {
  // No-op. Ver JSDoc arriba.
  void parcel;
}

// ============================================================
// Style dispatch (Track C: integración de selección sobre Track A)
// ============================================================

/**
 * Resuelve el `PathStyle` de un feature del GeoJSON de parcelas.
 *
 * v2.0 (sprint S5) — sigue exportado porque algunos tests lo usan, pero
 * la implementación con MapLibre no usa `style` callbacks: usa
 * `feature-state` + paint expressions en `MapLibreView`. Esta función
 * se conserva para callers que quieran aplicar los flags `isSelected`
 * y `hasFumigation` a un shape neutral.
 *
 * @param feature            Feature de GeoJSON del polígono (de `parcelCollection`).
 * @param parcelById         Mapa `id → DjiParcelRecord` que MapClient construye.
 * @param selectedParcelId   ID de la parcela actualmente seleccionada (o null).
 * @param fumigatedParcelIds Set<number> de parcelas fumigadas en últimos 6m.
 *                           Si undefined → backwards compat: todas fumigadas.
 */
export function resolveFeatureStyle(
  feature: { properties?: { id?: number } | null } | null | undefined,
  parcelById: Map<number, DjiParcelRecord>,
  selectedParcelId: number | null,
  fumigatedParcelIds?: Set<number>
): import("@/lib/map-styles").PathStyle {
  const id = feature?.properties?.id;
  const parcel = id !== undefined ? parcelById.get(id) : undefined;

  if (!parcel) {
    // Fallback defensivo: feature sin parcela matcheada. Pasamos un parcel
    // vacío a Track A (la función solo inspecciona is_orchard y field_type
    // → ambos falsy por default = estilo Farmland sólido).
    return getParcelPolygonStyle({} as DjiParcelRecord);
  }

  const isSelected = id === selectedParcelId;
  // Si `id` es undefined ya retornamos arriba (fallback). Pero TS no puede
  // inferirlo a través del control flow — `id` se mantiene como
  // `number | undefined` en este punto. El guard de tipo le dice al
  // compilador "acá id es number" y nos protege de regresiones si alguien
  // reordena las guards.
  const hasFumigation =
    fumigatedParcelIds === undefined || id === undefined
      ? true
      : fumigatedParcelIds.has(id);

  const baseStyle = getParcelPolygonStyle(parcel, { isSelected, hasFumigation });

  // Override Track C: la parcela seleccionada siempre es línea sólida,
  // independientemente del flag hasFumigation de Track A. La selección
  // es feedback inmediato del UI — el operador fumigador no debería
  // dudar si el contorno de la parcela activa es sólido o dashed.
  //
  // Implementación: removemos `dashArray` del spread (no asignamos null
  // porque el tipo `PathOptions` de Leaflet es `string | number[]`, no
  // acepta null). Leaflet trata `dashArray: undefined` como "sin patrón
  // = línea sólida", que es lo que queremos.
  if (isSelected) {
    const { dashArray: _ignored, ...solidStyle } = baseStyle;
    return solidStyle;
  }

  return baseStyle;
}
