// TypeScript declarations para lib/djiag-fumigations-fetcher.js (CommonJS).
// Los nombres de campo reflejan EXACTAMENTE lo que produce el .js.

export interface NormalizedFumigationDay {
  /** Segundos UTC del inicio del día (raw de DJI). */
  createTimestamp: number | null;
  /** 'YYYY-MM-DD' derivado del timestamp, en UTC. */
  date: string | null;
  workAreaM2: number | null;
  workTimeSec: number | null;
  workTimeMin: number | null;        // derivado
  sortieCount: number | null;
  sprayUsageMl: number | null;
  sprayUsageL: number | null;        // derivado
  doseLPerHa: number | null;         // derivado
  hasAgriculture: boolean;
}

export interface FumigationParams {
  /** 'YYYY-MM-DD' — formato dji_fumigations.fumigation_date. */
  fumigationDate: string | null;
  /** null en aggregate (no hay mapeo finca→fumigación). */
  parcelId: string | null;
  /** null por ahora — DJI no expone dron en aggregate. */
  droneCodeUsed: string | number | null;
  /** null por ahora — DJI no expone producto. */
  productUsed: string | null;
  areaFumigatedM2: number | null;
  durationMinutes: number | null;
  doseLPerHa: number | null;
  /** jsonb serializado (string) con metadata + raw del importer. */
  notes: string | null;
  recordedBy: string;
  source: string;
}

export interface ParsedAggrByDayResponse {
  days: NormalizedFumigationDay[];
  hasNextPage: boolean;
}

export declare function parseAggrByDayResponse(response: unknown, pageSize?: number): ParsedAggrByDayResponse;
export declare function normalizeDay(raw: unknown): NormalizedFumigationDay;
export declare function dayToFumigationParams(day: NormalizedFumigationDay): FumigationParams;
export declare function timestampToDateString(sec: number | null | undefined): string | null;
export declare function computeDoseLPerHa(sprayMl: number | null, areaM2: number | null): number | null;
export declare function paramsToPgArray(p: FumigationParams): unknown[];
export declare const UPSERT_SQL: string;
export declare const MS_PER_SEC: number;
export declare const ML_PER_L: number;
export declare const M2_PER_HA: number;
