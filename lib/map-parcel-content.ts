// lib/map-parcel-content.ts
//
// M3-M5 Track C — helpers puros para el contenido textual que se renderiza
// sobre un polígono de parcela en el mapa de /map (Leaflet) y para el
// aria-label del listbox accesible. Aislados de Leaflet (excepto
// `bindParcelLayerInteractions`, que recibe un duck-typed `ParcelLayerLike`
// para mantener testabilidad sin importar el paquete).
//
// Funciones exportadas:
//   - getParcelHoverContent(parcel): string  → Leaflet Tooltip (compacto)
//   - getParcelPopupContent(parcel): string  → Leaflet Popup (extendido)
//   - getParcelA11yLabel(parcel): string     → aria-label (sin HTML)
//   - bindParcelLayerInteractions(layer, parcel, opts?) → bindTooltip + bindPopup + on
//
// Decisiones de diseño:
//   - HTML escaped: leaflet renderiza innerHTML, así que cualquier valor
//     controlado por el usuario (land_name, alert_message) debe escaparse.
//     La función `escapeHtml` cubre los 5 caracteres básicos (& < > " ').
//   - Fechas: delegamos en `formatDateWithWeekday` (es-CO) para mantener
//     consistencia con el resto de la app. La función es TZ-fragile (UTC
//     midnight ↔ es-CO), pero ese comportamiento ya está documentado en
//     lib/format.ts y es la convención del repo.
//   - Estilo del polígono: NO vive acá — está en `lib/map-styles.ts`
//     (M3-M5 Track A, 2026-07-15) que es la single source of truth para
//     PathOptions de Leaflet en el repo. Track A maneja isSelected +
//     hasFumigation. Si necesitamos override del estilo seleccionado
//     (e.g. forzar dashArray: null), lo hacemos en el call site de
//     MapClient.tsx, NO en lib/.

import { formatDateWithWeekday } from "@/lib/format";
import type { AlertLevel } from "@/lib/types";

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
 * Opciones para `bindParcelLayerInteractions`.
 * Los handlers reciben un closure del caller (necesario para acceder al
 * `L.Map` instance que vive dentro de MapContainer y no es accesible
 * directamente desde el `layer`).
 */
export interface ParcelInteractionOptions {
  /** Handler para `mouseover` (ej. cambiar cursor a pointer). */
  onMouseOver?: () => void;
  /** Handler para `mouseout` (ej. reset cursor). */
  onMouseOut?: () => void;
}

/**
 * Subset de `L.Layer` con los métodos que necesitamos.
 * Duck-typed para mantener la función libre de imports de Leaflet.
 */
export interface ParcelLayerLike {
  bindTooltip: (content: string, options?: unknown) => unknown;
  bindPopup: (content: string, options?: unknown) => unknown;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
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
 * Contenido compacto para Leaflet Tooltip en hover de polígono.
 * 1 línea: nombre + área + última fumigación.
 *
 * Render esperado en el mapa:
 *   <strong>Porvenir STE 3</strong>
 *   5.32 ha · dom 14 jun 2026
 *
 * Por qué string (no JSX): Leaflet recibe HTML vía bindTooltip; si
 * devolviéramos JSX habría que renderizar a string en cada llamada
 * (overhead) o montar un portal. String es lo que Leaflet espera.
 */
export function getParcelHoverContent(parcel: ParcelContentInput): string {
  const name = parcel.name ?? "Sin nombre";
  const area = formatArea(parcel.areaHa);
  const last = formatLastFumigation(parcel.lastFumigationDate);
  return `<strong>${escapeHtml(name)}</strong><br/>${escapeHtml(area)} · ${escapeHtml(last)}`;
}

/**
 * Contenido extendido para Leaflet Popup en click de polígono.
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
 * Asocia el tooltip, popup y handlers de cursor a un `L.Layer` de Leaflet.
 * Pensado para ser invocado dentro de `<GeoJSON onEachFeature>`.
 *
 * @param layer  Layer de Leaflet (duck-typed vía ParcelLayerLike para testear).
 * @param parcel Datos de la parcela.
 * @param options Handlers opcionales (onMouseOver/onMouseOut) que reciben
 *                closures del caller. Típicamente: cambiar cursor del
 *                map container.
 */
export function bindParcelLayerInteractions(
  layer: ParcelLayerLike,
  parcel: ParcelContentInput,
  options?: ParcelInteractionOptions
): void {
  layer.bindTooltip(getParcelHoverContent(parcel), {
    sticky: true,
    direction: "top",
    opacity: 0.95
  });
  layer.bindPopup(getParcelPopupContent(parcel));
  if (options?.onMouseOver) {
    layer.on("mouseover", options.onMouseOver);
  }
  if (options?.onMouseOut) {
    layer.on("mouseout", options.onMouseOut);
  }
}
