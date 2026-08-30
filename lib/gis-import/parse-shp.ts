/**
 * lib/gis-import/parse-shp.ts — SHP (zipeado) → GeoJSON FeatureCollection.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * shpjs 6.2.0 es ESM-only y en Node.js hay que cargarlo vía dynamic import.
 * El input típico es un .zip que contiene .shp + .shx + .dbf + .prj.
 * shpjs.parseZip(zipBuffer) acepta un ArrayBuffer o Buffer y devuelve un
 * GeoJSON FeatureCollection (o array de FCs si el zip tiene varios shapefiles).
 *
 * Filtramos solo Polygon/MultiPolygon (las fumigaciones son sobre lotes).
 *
 * Testing: tests/lib/gis-import/parse-shp.test.ts
 */

import type { ImportFeature, ParseResult } from "./types";
import { extractFeatureName, normalizeGeometry } from "./normalize";

/**
 * Wrapper sobre shpjs.parseZip. Usamos dynamic import para que la carga
 * lazy del módulo ESM no rompa el startup del server (algunos bundlers
 * se confunden con shpjs + CommonJS interop).
 */
async function loadShpjs(): Promise<typeof import("shpjs")> {
  return await import("shpjs");
}

export async function parseShpZip(
  buffer: Buffer,
  fileName: string
): Promise<ParseResult> {
  // 1. Cargar shpjs
  let shpjs: typeof import("shpjs");
  try {
    shpjs = await loadShpjs();
  } catch (err) {
    throw new Error(
      `No se pudo cargar shpjs: ${err instanceof Error ? err.message : "error"}`
    );
  }

  // 2. Parsear el zip
  // shpjs.parseZip acepta ArrayBuffer | Buffer. Devuelve GeoJSON FeatureCollection
  // o un array de ellos si el zip trae varios shapefiles.
  let parsed: unknown;
  try {
    parsed = await shpjs.parseZip(buffer);
  } catch (err) {
    throw new Error(
      `Shapefile zip inválido (${fileName}): ${
        err instanceof Error ? err.message : "parse error"
      }`
    );
  }

  // 3. Normalizar a array de FeatureCollection
  const fcs: { features?: unknown[] }[] = Array.isArray(parsed)
    ? (parsed as { features?: unknown[] }[])
    : [parsed as { features?: unknown[] }];

  // 4. Filtrar polígonos, normalizar
  const features: ImportFeature[] = [];
  const warnings: string[] = [];

  for (const fc of fcs) {
    for (const f of fc.features ?? []) {
      const feat = f as {
        geometry?: { type?: string; coordinates?: unknown; geometries?: unknown[] };
        properties?: Record<string, unknown>;
      };
      const allowedTypes = new Set(["Polygon", "MultiPolygon", "GeometryCollection"]);
      if (
        !feat.geometry?.type ||
        !allowedTypes.has(feat.geometry.type)
      ) {
        warnings.push(
          `Feature ignorado (geometría ${feat.geometry?.type ?? "null"}): ${
            extractFeatureName(feat.properties) ?? "sin nombre"
          }`
        );
        continue;
      }
      const geom = normalizeGeometry(feat.geometry);
      if (!geom) {
        warnings.push(
          `Feature ignorado (no se pudo normalizar la geometría): ${
            extractFeatureName(feat.properties) ?? "sin nombre"
          }`
        );
        continue;
      }
      features.push({
        name: extractFeatureName(feat.properties) ?? `Parcela ${features.length + 1}`,
        properties: feat.properties ?? {},
        geometry: geom
      });
    }
  }

  if (features.length === 0) {
    warnings.push("El shapefile no contiene polígonos importables");
  }

  return { features, warnings, format: "shp" };
}
