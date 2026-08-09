// lib/reports/parcel-svg.ts
//
// Genera un SVG embebible con el polígono de la parcela dibujado,
// más el bbox y el centroide. Pensado para el PDF del reporte — el
// operador ve "la forma del lote" + coordenadas sin necesidad de
// servicios externos (EOX/Mapbox/MapTiler).
//
// feature/reports-level-1, sub-sprint 2 (2026-08-08).
//
// Decisiones:
//   - **Sin imagen satelital**: el SVG es vectorial puro (el polígono
//     dibujado, sin tiles). Trade-off: es más rápido, no requiere
//     servicios externos, y el archivo SVG pesa ~1KB. Si en el futuro
//     se quiere imagen satelital, hay que generar un screenshot con
//     Playwright (otro sprint, más complejo).
//   - **Proyección equirectangular**: lng=X, lat=Y mapeado linealmente
//     al viewBox. No es una proyección cartográfica real, pero para
//     un polígono de ~1km (una parcela cañera) la distorsión es
//     imperceptible. Y es trivial de calcular.
//   - **viewBox cuadrado** con padding: el polígono se centra y
//     se escala para fitear en un cuadrado `size × size`, con margen
//     `padding` (default 8% del lado). Eso garantiza que el SVG se
//     ve bien cuando se embebe en un rectángulo de cualquier tamaño.
//   - **Eje Y invertido**: SVG tiene Y=0 arriba, lat tiene Y=0 abajo.
//     Multiplicamos por `-1` para que el polígono se vea "normal".
//   - **Soporte Polygon y MultiPolygon**: las parcelas manuales
//     (`source='manual'`) tienen Polygon simple; las del dataset DJI
//     pueden ser MultiPolygon si la suerte tiene varios islotes.
//
// Out of scope:
//   - Imagen satelital de fondo (requiere Playwright screenshot o
//     servicio externo de static maps).
//   - Waypoints (los puntos del vuelo del dron) — el reporte es por
//     parcela, no por vuelo.

import type { Geometry } from "geojson";

/** Bounding box del polígono en WGS84 (lng/lat). */
export interface ParcelBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** Centroide geográfico (promedio de los vértices del polígono). */
export interface ParcelCentroid {
  lng: number;
  lat: number;
}

/** Resultado de `buildParcelLocation`. */
export interface ParcelLocation {
  /** SVG embebible (string self-contained, sin assets externos). */
  svg: string;
  /** Bounding box. `null` si el input no tiene coordenadas válidas. */
  bbox: ParcelBbox | null;
  /** Centroide. `null` si el input no tiene coordenadas válidas. */
  centroid: ParcelCentroid | null;
  /** Tamaño del viewBox del SVG (cuadrado). */
  size: number;
}

const DEFAULT_SIZE = 240;
const DEFAULT_PADDING = 0.08; // 8% del lado como margen

/**
 * Genera el SVG, bbox y centroide de un polígono de parcela.
 *
 * Si el `geometry` es null, no tiene coordenadas, o no es Polygon /
 * MultiPolygon → devuelve un placeholder SVG con el texto "Sin geometría"
 * y bbox/centroid en null. El caller (template PDF) decide si renderiza
 * la sección o no.
 */
export function buildParcelLocation(
  geometry: Geometry | null | undefined,
  options: { size?: number; padding?: number } = {}
): ParcelLocation {
  const size = options.size ?? DEFAULT_SIZE;
  const padding = options.padding ?? DEFAULT_PADDING;

  // --- 1. Extraer todos los vértices como [lng, lat] ---
  const coords = extractCoordinates(geometry);
  if (coords.length === 0) {
    return {
      svg: placeholderSvg("Sin geometría", size),
      bbox: null,
      centroid: null,
      size
    };
  }

  // --- 2. Calcular bbox y centroide ---
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  let sumLng = 0;
  let sumLat = 0;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    sumLng += lng;
    sumLat += lat;
  }
  const centroid: ParcelCentroid = {
    lng: sumLng / coords.length,
    lat: sumLat / coords.length
  };
  const bbox: ParcelBbox = { minLng, minLat, maxLng, maxLat };

  // --- 3. Calcular escala y offset para encajar en `size × size` ---
  // El bbox puede ser muy chiquito (parcela urbana) o muy ancho en
  // lng vs lat. Tomamos el rango mayor y agregamos padding.
  const dataWidth = maxLng - minLng || 1; // evita división por 0
  const dataHeight = maxLat - minLat || 1;
  const dataMax = Math.max(dataWidth, dataHeight);
  const scale = (size * (1 - 2 * padding)) / dataMax;
  // El viewBox del SVG va de (0, 0) a (size, size). Necesitamos
  // mapear (lng, lat) → (x, y) en ese viewBox, centrado.
  const cx = (minLng + maxLng) / 2;
  const cy = (minLat + maxLat) / 2;
  // x = (lng - cx) * scale + size/2
  // y = -(lat - cy) * scale + size/2 (Y invertido)

  // --- 4. Construir el path SVG ---
  // Para Polygon: un solo `<path>` con todos los rings.
  // Para MultiPolygon: un `<path>` por cada Polygon (fill rule even-odd
  // para que los huecos se vean bien).
  let pathD = "";
  if (geometry?.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      pathD += ringToPath(ring, cx, cy, scale, size) + " ";
    }
  } else if (geometry?.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) {
        pathD += ringToPath(ring, cx, cy, scale, size) + " ";
      }
    }
  }

  // --- 5. Armar el SVG con metadata ---
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" `,
    `width="${size}" height="${size}" role="img" `,
    `aria-label="Polígono de la parcela (centroide ${formatLatLng(centroid)})">`,
    `<rect width="${size}" height="${size}" fill="#f1f4f1" />`,
    // Grilla muy sutil para dar sensación de mapa (cada 25% del viewBox).
    `<g stroke="#d2ddd6" stroke-width="0.5" fill="none" opacity="0.6">`,
    `<line x1="0" y1="${size / 2}" x2="${size}" y2="${size / 2}" />`,
    `<line x1="${size / 2}" y1="0" x2="${size / 2}" y2="${size}" />`,
    `</g>`,
    // El polígono.
    `<path d="${pathD.trim()}" fill="#0b5f2d" fill-opacity="0.35" `,
    `stroke="#0b5f2d" stroke-width="1.5" stroke-linejoin="round" />`,
    // El centroide.
    `<circle cx="${size / 2}" cy="${size / 2}" r="3" fill="#a93232" `,
    `stroke="#ffffff" stroke-width="1" />`,
    `</svg>`
  ].join("");

  return { svg, bbox, centroid, size };
}

/** Extrae todos los pares [lng, lat] del geometry, sin importar el tipo. */
function extractCoordinates(geometry: Geometry | null | undefined): Array<[number, number]> {
  if (!geometry) return [];
  if (geometry.type === "Polygon") {
    return geometry.coordinates.flatMap((ring) =>
      ring.map((c) => [c[0]!, c[1]!] as [number, number])
    );
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((poly) =>
      poly.flatMap((ring) =>
        ring.map((c) => [c[0]!, c[1]!] as [number, number])
      )
    );
  }
  return [];
}

/** Convierte un ring del GeoJSON a un string `d` de path SVG. */
function ringToPath(
  ring: ReadonlyArray<ReadonlyArray<number>>,
  cx: number,
  cy: number,
  scale: number,
  size: number
): string {
  if (ring.length === 0) return "";
  // Primer punto con M, los siguientes con L.
  const parts: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const point = ring[i]!;
    // GeoJSON Position es number[]; acá asumimos siempre 2D
    // (lng, lat). Si el dato viene 3D, ignoramos z/altura.
    const lng = point[0]!;
    const lat = point[1]!;
    const x = (lng - cx) * scale + size / 2;
    const y = -(lat - cy) * scale + size / 2;
    parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  parts.push("Z"); // cerrar
  return parts.join(" ");
}

/** SVG placeholder cuando no hay geometría. */
function placeholderSvg(message: string, size: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" `,
    `width="${size}" height="${size}" role="img" aria-label="${message}">`,
    `<rect width="${size}" height="${size}" fill="#f7f9fb" stroke="#d2ddd6" />`,
    `<text x="50%" y="50%" font-family="sans-serif" font-size="12" `,
    `fill="#587064" text-anchor="middle" dominant-baseline="middle">${message}</text>`,
    `</svg>`
  ].join("");
}

/** Formato es-CO: "lat, lng" con 5 decimales (suficiente para ±1m). */
function formatLatLng(c: ParcelCentroid): string {
  return `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
}

/** Formatea el bbox como "minLat,minLng → maxLat,maxLng" (orden lat primero
 *  para que sea legible para el operador, no para GIS). Usa el formato
 *  es-CO (coma decimal) para ser consistente con el resto del PDF. */
export function formatBbox(b: ParcelBbox): string {
  // Mismo helper que el resto del módulo reports — `de-DE` produce
  // "3,40" (con coma decimal), coincidente con es-CO.
  const fmt = new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5
  });
  return [
    `${fmt.format(b.minLat)}, ${fmt.format(b.minLng)}`,
    `${fmt.format(b.maxLat)}, ${fmt.format(b.maxLng)}`
  ].join(" → ");
}
