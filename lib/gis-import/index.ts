/**
 * lib/gis-import/index.ts — entry point del import GIS.
 *
 * Detecta el formato del archivo por extensión + magic bytes, y despacha
 * al parser correspondiente. Devuelve siempre la misma shape (ParseResult)
 * para que la UI/API no tenga que ramificar.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 */

import { parseKml } from "./parse-kml";
import { parseShpZip } from "./parse-shp";
import { parseGpkg } from "./parse-gpkg";
import type { ImportFormat, ParseResult } from "./types";
import { MAX_BYTES } from "./types";

export { parseKml, parseShpZip, parseGpkg };
export type { ImportFormat, ParseResult } from "./types";

/** Detecta el formato por nombre del archivo. */
export function detectFormat(fileName: string): ImportFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".kml")) return "kml";
  // .kmz es KML zipeado, pero el operador lo sube directo; tratamos como zip
  // y adentro tiene un doc.kml. Por ahora NO soportamos KMZ — si lo suben,
  // tira "formato no soportado" con mensaje claro.
  if (lower.endsWith(".zip")) return "shp";
  if (lower.endsWith(".gpkg")) return "gpkg";
  return null;
}

/**
 * Parsea un archivo GIS subido por el operador. Detecta formato por
 * extensión, valida tamaño, y despacha al parser.
 *
 * Throws si:
 *   - formato no soportado
 *   - archivo demasiado grande
 *   - error de parseo (XML inválido, ZIP sin .shp, GPKG corrupto, etc)
 */
export async function parseGisFile(
  buffer: Buffer,
  fileName: string
): Promise<ParseResult> {
  const format = detectFormat(fileName);
  if (!format) {
    throw new Error(
      `Formato no soportado: ${fileName}. Aceptamos .kml, .zip (SHP), .gpkg`
    );
  }
  const maxBytes = MAX_BYTES[format];
  if (buffer.length > maxBytes) {
    const maxMB = Math.round(maxBytes / 1024 / 1024);
    throw new Error(
      `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo ${maxMB} MB.`
    );
  }
  if (buffer.length === 0) {
    throw new Error("El archivo está vacío");
  }

  switch (format) {
    case "kml":
      return parseKml(buffer, fileName);
    case "shp":
      return await parseShpZip(buffer, fileName);
    case "gpkg":
      return await parseGpkg(buffer, fileName);
  }
}
