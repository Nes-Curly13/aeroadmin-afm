// TypeScript declarations para scripts/fetch-lands-direct.js (CommonJS).

export interface ParsedBbox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export declare function main(): Promise<void>;
export declare function parseBbox(s: string | null | undefined): ParsedBbox;
