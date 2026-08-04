// Type shim para shpjs — no tiene @types oficiales y la lib es ESM.
// Solo necesitamos el subset que usamos en el parser.

declare module "shpjs" {
  export interface GeoJsonGeometry {
    type: string;
    coordinates?: unknown;
    geometries?: GeoJsonGeometry[];
  }

  export interface GeoJsonFeature {
    type: "Feature";
    geometry: GeoJsonGeometry;
    properties: Record<string, unknown> | null;
  }

  export interface GeoJsonFeatureCollection {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  }

  /**
   * Parsea un .zip que contiene un shapefile (con .shp + .shx + .dbf + .prj).
   * Devuelve un FC o un array de FCs si el zip tiene varios shapefiles.
   */
  export function parseZip(
    buffer: ArrayBuffer | Buffer | Uint8Array
  ): Promise<GeoJsonFeatureCollection | GeoJsonFeatureCollection[]>;

  const _default: {
    parseZip: typeof parseZip;
  };
  export default _default;
}
