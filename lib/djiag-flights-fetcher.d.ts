// TypeScript declarations para lib/djiag-flights-fetcher.js (CommonJS).
// Los nombres de campo reflejan EXACTAMENTE lo que produce normalizeFlight()
// y parsePerFlightFile() — ver el .js para el contrato. Si cambias el .js,
// sincronizá esto.

export interface NormalizedFlight {
  flightId: number | null;
  parcelId: string | null;          // null hasta spatial join
  droneSerial: string | null;
  droneNickname: string | null;
  pilotName: string | null;
  flyerName: string | null;
  district: string | null;
  location: string | null;
  startAt: Date | null;
  endAt: Date | null;
  durationSeconds: number | null;
  areaM2: number | null;
  sprayUsageMl: number | null;
  workSpeedMS: number | null;
  sprayWidthM: number | null;
  radarHeightM: number | null;
  manualMode: boolean | null;
  modeName: number | null;
  createDate: string | null;        // 'YYYY-MM-DD'
  lng: number | null;
  lat: number | null;
  /**
   * jsonb con metadata del importer + payload crudo de DJI.
   * Estructura fija: { source, raw } — ver buildNotes() en el .js.
   */
  notes: {
    source: string;
    raw: Record<string, unknown>;
  };
}

export interface ParsedPerFlightFile {
  flights: NormalizedFlight[];
  meta: {
    totalCount: number;
    totalPages: number | null;
    capturedAt: string | null;
    days: number | string | null;
    pageSize: number | string | null;
    pagesCaptured: number | string | null;
  };
}

export declare function parsePerFlightFile(file: unknown): ParsedPerFlightFile;
export declare function normalizeFlight(raw: unknown): NormalizedFlight;
export declare const flightToParams: (f: NormalizedFlight) => NormalizedFlight;
export declare function paramsToPgArray(f: NormalizedFlight): unknown[];
export declare const UPSERT_SQL: string;
export declare const MS_PER_SEC: number;
