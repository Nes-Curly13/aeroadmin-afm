// TypeScript declarations para lib/djiag-lands-fetcher.js (CommonJS).
// Permite que los tests TS lo importen con tipos.

import type { NormalizedLand, ParsedLandsPage, DjiBbox, DjiLandsResponse } from "./djiag-graphql-types";

export interface NormalizedPosition {
  lng: number | null;
  lat: number | null;
}

export declare function normalizeLand(node: unknown): NormalizedLand;
export declare function normalizePosition(pos: unknown): NormalizedPosition | null;
export declare function normalizeBbox(bbox: unknown): DjiBbox | null;
export declare function parseLandsResponse(response: unknown): ParsedLandsPage;
export declare function muToHa(mu: number | null | undefined): number | null;
export declare function muToM2(mu: number | null | undefined): number | null;
export declare function haToMu(ha: number | null | undefined): number | null;
export declare const MU_PER_HA: number;
export declare const HA_PER_MU: number;
export declare const M2_PER_MU: number;
