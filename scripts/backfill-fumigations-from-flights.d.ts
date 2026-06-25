// TypeScript declarations para scripts/backfill-fumigations-from-flights.js (CommonJS).

export declare function main(): Promise<void>;
export declare function backfillFumigationsFromFlights(opts?: {
  days?: number;
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<{ updated: number; skipped: number; days: number }>;
export declare function droneCodeFromNickname(nickname: string | null | undefined): number | null;
