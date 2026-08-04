/**
 * lib/gis-import/types.ts — tipos compartidos del import GIS.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * El objetivo del import es: el operador sube un archivo SHP/KML/GPKG,
 * el sistema lo convierte a un FeatureCollection GeoJSON, y le muestra
 * una preview con los nombres detectados y los polígonos. El operador
 * puede editar los nombres y confirmar el alta.
 *
 * Estructura de un feature importado:
 *   - name: nombre sugerido para la parcela (edit-able en la UI)
 *   - properties: atributos crudos del archivo GIS (para auditoría)
 *   - geometry: polígono GeoJSON (Polygon o MultiPolygon)
 *
 * El formato final que va a la API de creación de parcela es el mismo
 * que ya acepta POST /api/admin/parcels (geometry + land_name).
 */

export type ImportFormat = "kml" | "shp" | "gpkg";

export interface ImportGeometry {
  type: "Polygon" | "MultiPolygon";
  /** Coordinates: Polygon = [ring], MultiPolygon = [[ring]]. */
  coordinates: number[][][] | number[][][][];
}

export interface ImportFeature {
  /** Nombre detectado a partir de las properties del archivo. Editable. */
  name: string;
  /** Atributos crudos del GIS (name, id, etc). */
  properties: Record<string, unknown>;
  /** Geometría GeoJSON normalizada. */
  geometry: ImportGeometry;
}

export interface ParseResult {
  features: ImportFeature[];
  /** Mensajes no-fatales (features saltados, etc). */
  warnings: string[];
  format: ImportFormat;
}

/** Tamaño máximo por formato. */
export const MAX_BYTES = {
  kml: 25 * 1024 * 1024,  // 25 MB
  shp: 50 * 1024 * 1024,  // 50 MB
  gpkg: 100 * 1024 * 1024 // 100 MB
} as const;
