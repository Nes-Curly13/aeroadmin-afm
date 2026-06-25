// TypeScript types para los responses de DJI AG.
//
// Convenciones:
//   - camelCase (igual que el JSON que devuelve DJI) — no transformar.
//   - Optional fields se marcan con `?` o `| null`. La diferencia:
//     - `?` = la key puede no existir en el JSON
//     - `| null` = la key existe pero su valor es `null`
//   - Enums se modelan como string literal unions; ampliar según
//     observaciones del response real.
//
// Este archivo es la única fuente de verdad para los shapes. Los módulos
// JS los producen (parsing) y los consumers TS los consumen.

export interface DjiBbox {
  upperRight: { lat: number; lng: number } | null;
  downLeft: { lat: number; lng: number } | null;
}

export interface DjiStorage {
  signedURL: string;
  uuid?: string;
  contentMd5?: string;
}

export interface DjiLandNode {
  uuid: string;
  externalId: string;
  name: string;
  address: string | null;
  landType: string | null;
  sourceType: string | null;
  totalArea: number | null;          // MU
  workArea: number | null;           // MU
  totalObstacleArea: number | null;  // MU
  precision: number | null;
  precisionType: string | null;
  maxGeometryParameterOffset: number | null;
  position: { lng: number | null; lat: number | null } | null;
  bbox: DjiBbox | null;
  geometry: { storage: DjiStorage | null } | null;
  waypoint: { storage: DjiStorage | null } | null;
  parameter: { storage: DjiStorage | null } | null;
  serialNumber: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DjiLandsEdge {
  cursor: string;
  node: DjiLandNode;
}

export interface DjiLandsConnection {
  totalCount: number;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  edges: DjiLandsEdge[];
}

export interface DjiLandsResponse {
  data: {
    lands: DjiLandsConnection;
  };
}

/** Output del normalizer (lib/djiag-lands-fetcher.js) — campos planos y garantizados. */
export interface NormalizedLand {
  uuid: string | null;
  externalId: string | null;
  name: string;
  address: string | null;
  landType: string | null;
  sourceType: string | null;
  totalAreaMu: number | null;
  workAreaMu: number | null;
  obstacleAreaMu: number | null;
  precision: number | null;
  precisionType: string | null;
  maxGeometryParameterOffset: number | null;
  position: { lng: number | null; lat: number | null } | null;
  bbox: DjiBbox | null;
  geometryUrl: string | null;
  geometryStorageUuid: string | null;
  geometryContentMd5: string | null;
  waypointUrl: string | null;
  parameterUrl: string | null;
  serialNumber: string | null;
  tags: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParsedLandsPage {
  lands: NormalizedLand[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}
