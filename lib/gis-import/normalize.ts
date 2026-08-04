/**
 * lib/gis-import/normalize.ts — helpers compartidos del import GIS.
 *
 * Funciones de normalización usadas por los 3 parsers (KML/SHP/GPKG):
 *   - extractFeatureName: agarra el nombre del feature de un objeto properties
 *     probando varios keys comunes (en español, inglés, GIS genéricos).
 *   - normalizeGeometry: valida que la geometría sea Polygon/MultiPolygon
 *     con coordinates mínimas, y la devuelve en la forma esperada por
 *     el resto de la app.
 */

import type { ImportGeometry } from "./types";

/**
 * Keys que usamos como "nombre" del feature. En este orden: nombre más
 * humano primero, IDs técnicas al final. Si ninguno matchea, devuelve null.
 *
 * El operador después puede editar el nombre en la UI antes de confirmar.
 */
const NAME_KEYS = [
  "name",
  "nombre",
  "nom",
  "name_",
  "NAME",
  "NOMBRE",
  "NOM",
  "LOTE",
  "lote",
  "LOT",
  "lot",
  "PARCELA",
  "parcela",
  "PARCEL",
  "parcel",
  "FINCA",
  "finca",
  "FARM",
  "farm",
  "ID",
  "id",
  "OBJECTID",
  "objectid",
  "FID",
  "fid"
] as const;

export function extractFeatureName(
  properties: Record<string, unknown> | undefined | null
): string | null {
  if (!properties) return null;
  for (const key of NAME_KEYS) {
    const v = properties[key];
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
    // Algunos GIS guardan el nombre como number (OBJECTID)
    if (typeof v === "number" && Number.isFinite(v)) {
      return String(v);
    }
  }
  return null;
}

/**
 * Normaliza una geometría GeoJSON. Devuelve null si:
 *   - el tipo no es Polygon ni MultiPolygon
 *   - coordinates está vacío
 *   - el primer ring no tiene al menos 4 puntos (3 + cierre)
 *
 * Casos especiales:
 *   - GeometryCollection (KML MultiGeometry): si TODAS las geometrías
 *     son Polygon, las consolidamos en un MultiPolygon. Si alguna es
 *     otro tipo, devolvemos null (no importable como parcela).
 *   - 3D coords (KML trae [lng, lat, alt]): las aplana a 2D. La BD
 *     tiene columnas 2D y rechaza con "Geometry has Z dimension".
 *
 * Esta función NO chequea `ST_IsValid` ni auto-intersecciones — eso
 * lo podría hacer la BD con ST_MakeValid, pero para el MVP aceptamos
 * geometrías laxxas (mismo criterio que el alta manual).
 */
export function normalizeGeometry(
  geom: unknown
): ImportGeometry | null {
  if (!geom || typeof geom !== "object") return null;
  const g = geom as {
    type?: string;
    coordinates?: unknown;
    geometries?: unknown[];
  };

  if (g.type === "GeometryCollection") {
    // Consolidar todos los Polygon en un MultiPolygon
    const polys: number[][][][] = [];
    for (const child of g.geometries ?? []) {
      const norm = normalizeGeometry(child);
      if (!norm) return null; // si alguno no es polígono, descartamos
      if (norm.type === "Polygon") {
        polys.push(norm.coordinates as number[][][]);
      } else {
        polys.push(...(norm.coordinates as number[][][][]));
      }
    }
    if (polys.length === 0) return null;
    return {
      type: polys.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates: polys.length === 1 ? polys[0] : polys
    };
  }

  if (g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  if (!Array.isArray(g.coordinates)) return null;
  if (g.coordinates.length === 0) return null;

  // Helper: aplana un punto 2D/3D/4D a [lng, lat]. KML a veces trae
  // [lng, lat, alt], ShapeFile trae [lng, lat], y algunos GIS meten
  // un cuarto elemento (M measure). Tomamos siempre los primeros 2.
  const flattenPoint = (pt: unknown): [number, number] | null => {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const a = Number(pt[0]);
    const b = Number(pt[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [a, b];
  };

  if (g.type === "Polygon") {
    // Polygon: [ring] — cada ring es [[lng, lat], ...]
    const rings: number[][][] = [];
    for (const rawRing of g.coordinates) {
      if (!Array.isArray(rawRing)) continue;
      const flat: number[][] = [];
      for (const pt of rawRing) {
        const f = flattenPoint(pt);
        if (!f) continue;
        flat.push(f);
      }
      // ring debe tener al menos 4 puntos (3 + cierre) para ser válido
      if (flat.length < 4) continue;
      rings.push(flat);
    }
    if (rings.length === 0) return null;
    return {
      type: "Polygon",
      coordinates: rings
    };
  } else {
    // MultiPolygon: [[ring]] — cada polygon es [ring]
    const polys: number[][][][] = [];
    for (const rawPoly of g.coordinates) {
      if (!Array.isArray(rawPoly)) continue;
      const rings: number[][][] = [];
      for (const rawRing of rawPoly) {
        if (!Array.isArray(rawRing)) continue;
        const flat: number[][] = [];
        for (const pt of rawRing) {
          const f = flattenPoint(pt);
          if (!f) continue;
          flat.push(f);
        }
        if (flat.length < 4) continue;
        rings.push(flat);
      }
      if (rings.length > 0) polys.push(rings);
    }
    if (polys.length === 0) return null;
    return {
      type: "MultiPolygon",
      coordinates: polys
    };
  }
}

/** Saca el área aproximada en m² de un polígono usando la fórmula esférica de L'Huilier. */
export function approxAreaM2(geom: ImportGeometry): number {
  // Para MultiPolygon, sumamos las áreas de cada polígono. Para Polygon,
  // es un solo outer ring (geom.coordinates[0]). Esto es deliberadamente
  // aproximado — para cálculo preciso usar ST_Area de PostGIS, pero para
  // el "preview" del import GIS alcanza.
  const rings: number[][][] =
    geom.type === "Polygon"
      ? [geom.coordinates[0] as number[][]]
      : (geom.coordinates as number[][][][]).map(
          (p) => p[0] as number[][]
        );

  let total = 0;
  const R = 6_378_137; // radio de la Tierra en m (WGS84)
  for (const ring of rings) {
    if (ring.length < 4) continue;
    // Fórmula de L'Huilier para el área de un polígono esférico:
    //   A = -R² * Σ (λ_{i+1} - λ_i) * (sin(φ_i) + sin(φ_{i+1})) / 2
    // donde λ = longitud, φ = latitud, ambas en radianes.
    // El signo negativo es para que la orientación horaria dé positivo.
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng1, lat1] = ring[i];
      const [lng2, lat2] = ring[i + 1];
      const dLng = (lng2 - lng1) * (Math.PI / 180);
      const sinLat1 = Math.sin((lat1 * Math.PI) / 180);
      const sinLat2 = Math.sin((lat2 * Math.PI) / 180);
      area -= dLng * (sinLat1 + sinLat2) / 2;
    }
    total += Math.abs(area * R * R);
  }
  return total;
}
