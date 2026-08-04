/**
 * lib/gis-import/parse-gpkg.ts — GeoPackage (.gpkg) → GeoJSON FeatureCollection.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * @ngageoint/geopackage 4.2.8 usa better-sqlite3 en Node.js. Abrimos el
 * .gpkg, leemos la primera feature table, y convertimos cada fila a
 * un Feature GeoJSON (filtramos solo Polygon/MultiPolygon).
 *
 * Decisión de implementación:
 *   - Tomamos SOLO la primera feature table del archivo. Si hay varias,
 *     el operador debe dividir el archivo o aceptar el subset.
 *     El MVP no soporta multi-layer; el caso de uso típico es 1 capa.
 *   - Las geometrias vienen como GeoJSON (geometry.type + coordinates) si
 *     el SRS es WGS84 (4326), o como BLOB WKB si no. Convertimos
 *     WKB → GeoJSON usando la lib interna del geopackage.
 *
 * Testing: tests/lib/gis-import/parse-gpkg.test.ts
 */

import type { ImportFeature, ParseResult } from "./types";
import { extractFeatureName, normalizeGeometry } from "./normalize";

/** Tamaño máximo aceptado para un .gpkg. 100 MB. */
export const GPKG_MAX_BYTES = 100 * 1024 * 1024;

interface GpkgModule {
  GeoPackageAPI: {
    open: (bytes: Uint8Array) => Promise<GpkgInstance>;
  };
}

interface GpkgInstance {
  getFeatureTables: () => string[];
  getFeatureDao: (table: string) => GpkgFeatureDao;
  close: () => void;
  getSrs: (srsId: number) => unknown;
}

interface GpkgFeatureDao {
  getSrsId?: () => number;
  getColumns: () => { name: string }[];
  iterate: (cb: (row: unknown) => void) => void;
}

/**
 * Lazy load de geopackage — pesa mucho y no se necesita hasta que el
 * operador sube un .gpkg. Mejor startup time del server.
 */
async function loadGpkg(): Promise<GpkgModule> {
  const mod = await import("@ngageoint/geopackage");
  return mod as unknown as GpkgModule;
}

/**
 * Convierte un row de GeoPackage a un Feature GeoJSON-like.
 * El row.getGeometry() devuelve un objeto {type, coordinates} si la SRS
 * es WGS84, o un Uint8Array con WKB si no.
 */
function rowToFeature(
  row: unknown,
  columns: { name: string }[]
): { properties: Record<string, unknown>; geometry: unknown } | null {
  const r = row as {
    getGeometry: () => unknown;
    [key: string]: unknown;
  };
  const properties: Record<string, unknown> = {};
  for (const c of columns) {
    if (c.name === "geometry") continue;
    const v = (r as Record<string, unknown>)[c.name];
    if (v !== undefined) properties[c.name] = v;
  }
  const geom = r.getGeometry?.();
  if (!geom) return null;
  return { properties, geometry: geom };
}

export async function parseGpkg(
  buffer: Buffer,
  fileName: string
): Promise<ParseResult> {
  // 1. Cargar la lib
  const { GeoPackageAPI } = await loadGpkg();

  // 2. Abrir el .gpkg
  let gpkg: GpkgInstance;
  try {
    // GeoPackageAPI.open espera ArrayBuffer o Uint8Array.
    gpkg = await GeoPackageAPI.open(new Uint8Array(buffer));
  } catch (err) {
    throw new Error(
      `GeoPackage inválido (${fileName}): ${
        err instanceof Error ? err.message : "open error"
      }`
    );
  }

  try {
    // 3. Listar feature tables. Tomar la primera.
    const tables = gpkg.getFeatureTables();
    if (tables.length === 0) {
      throw new Error("El GeoPackage no contiene feature tables");
    }
    const warnings: string[] = [];
    if (tables.length > 1) {
      warnings.push(
        `El GeoPackage tiene ${tables.length} feature tables; importamos solo la primera ("${tables[0]}")`
      );
    }
    const table = tables[0];
    const dao = gpkg.getFeatureDao(table);

    // 4. Iterar filas, convertir a GeoJSON features
    const features: ImportFeature[] = [];
    const columns = dao.getColumns();
    const nameColumn = columns.find(
      (c) =>
        /^(name|nombre|name_|nom|name$)/i.test(c.name) &&
        c.name !== "geometry"
    );

    let rowCount = 0;
    dao.iterate((row: unknown) => {
      rowCount++;
      const f = rowToFeature(row, columns);
      if (!f) {
        warnings.push(`Fila ${rowCount}: sin geometría, ignorada`);
        return;
      }
      const geom = normalizeGeometry(f.geometry as { type: string; coordinates: unknown });
      if (!geom) {
        warnings.push(`Fila ${rowCount}: geometría inválida, ignorada`);
        return;
      }
      if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
        warnings.push(
          `Fila ${rowCount} ignorada (geometría ${geom.type}, no es polígono)`
        );
        return;
      }
      // Si la columna sugerida existe, usarla; si no, fallback a extractFeatureName.
      const suggestedName =
        nameColumn && (f.properties as Record<string, unknown>)[nameColumn.name]
          ? String((f.properties as Record<string, unknown>)[nameColumn.name])
          : extractFeatureName(f.properties);
      features.push({
        name: suggestedName ?? `Parcela ${features.length + 1}`,
        properties: f.properties,
        geometry: geom
      });
    });

    if (features.length === 0) {
      warnings.push("El GeoPackage no contiene polígonos importables");
    }
    return { features, warnings, format: "gpkg" };
  } finally {
    try {
      gpkg.close();
    } catch {
      // close puede fallar si el file ya se liberó; no es fatal
    }
  }
}
