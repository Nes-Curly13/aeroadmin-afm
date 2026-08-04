/**
 * lib/gis-import/parse-kml.ts — KML → GeoJSON FeatureCollection (polígonos).
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * Implementación:
 *   - @tmcw/togeojson: parser KML/GPX → GeoJSON (orientado a browser, usa DOMParser)
 *   - @xmldom/xmldom: DOMParser compatible con Node.js
 *   - Filtramos solo Polygon y MultiPolygon (las fumigaciones son sobre lotes)
 *
 * @tmcw/togeojson 7.1.2 exporta `kml` que toma un Document XML y devuelve
 * un GeoJSON FeatureCollection.
 *
 * Testing: tests/lib/gis-import/parse-kml.test.ts
 */

import { DOMParser } from "@xmldom/xmldom";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import type { ImportFeature, ParseResult } from "./types";
import { extractFeatureName, normalizeGeometry } from "./normalize";

/** Tamaño máximo aceptado para un KML. 25 MB. */
export const KML_MAX_BYTES = 25 * 1024 * 1024;

export function parseKml(buffer: Buffer, fileName: string): ParseResult {
  // 1. Parsear XML
  let doc: Document;
  try {
    const xml = buffer.toString("utf8");
    // xmldom 0.9.x: errorHandler deprecado, ahora se pasa onError(level, msg).
    // Por defecto xmldom tira en errores fatales — los que nos importan.
    // Pasamos un handler no-op para warnings/errors no-fatales (KML de
    // Google Earth / QGIS a veces trae entities que rompen warnings).
    doc = new DOMParser({
      onError: () => {
        // noop — solo logueamos los fatales que tira como throw
      }
    }).parseFromString(xml, "application/xml") as unknown as Document;
  } catch (err) {
    throw new Error(
      `KML inválido (${fileName}): ${err instanceof Error ? err.message : "XML parse error"}`
    );
  }

  // 2. Convertir a GeoJSON
  let fc;
  try {
    fc = kmlToGeoJSON(doc);
  } catch (err) {
    throw new Error(
      `KML no se pudo convertir a GeoJSON: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }

  // 3. Filtrar solo Polygon/MultiPolygon, normalizar
  const features: ImportFeature[] = [];
  const warnings: string[] = [];

  for (const f of fc.features ?? []) {
    const allowedTypes = new Set(["Polygon", "MultiPolygon", "GeometryCollection"]);
    if (!f.geometry?.type || !allowedTypes.has(f.geometry.type)) {
      warnings.push(
        `Feature ignorado (geometría ${f.geometry?.type ?? "null"} no es polígono): ${
          extractFeatureName(f.properties) ?? "sin nombre"
        }`
      );
      continue;
    }
    const geom = normalizeGeometry(f.geometry);
    if (!geom) {
      warnings.push(
        `Feature ignorado (no se pudo normalizar la geometría): ${
          extractFeatureName(f.properties) ?? "sin nombre"
        }`
      );
      continue;
    }
    features.push({
      name: extractFeatureName(f.properties) ?? `Parcela ${features.length + 1}`,
      properties: (f.properties ?? {}) as Record<string, unknown>,
      geometry: geom
    });
  }

  if (features.length === 0) {
    warnings.push("El KML no contiene polígonos importables");
  }

  return { features, warnings, format: "kml" };
}
