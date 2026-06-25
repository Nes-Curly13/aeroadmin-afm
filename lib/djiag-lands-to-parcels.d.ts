// TypeScript declarations para lib/djiag-lands-to-parcels.js (CommonJS).

export interface ParcelParams {
  externalId: string | null;
  djiLandUuid: string | null;
  landName: string | null;
  fieldType: "Orchards" | "Farmland";
  isOrchard: boolean;
  landTypeRaw: string | null;
  positionWkt: string | null;
  bboxWkt: string | null;
  tags: string[] | null;
  precisionM: number | null;
  precisionType: string | null;
  serialNumber: string | null;
  totalAreaMu: number | null;
  workAreaMu: number | null;
  obstacleAreaMu: number | null;
  sourceUrlGeometry: string | null;
  sourceUrlWaypoint: string | null;
  sourceUrlParameter: string | null;
}

export declare function landToParcelParams(land: unknown): ParcelParams;
export declare function positionToWkt(pos: unknown): string | null;
export declare function bboxToWkt(bbox: unknown): string | null;
export declare function paramsToPgArray(batchId: number, p: ParcelParams): unknown[];
export declare const UPSERT_SQL: string;
export declare const MU_PER_HA: number;
export declare const HA_PER_MU: number;
