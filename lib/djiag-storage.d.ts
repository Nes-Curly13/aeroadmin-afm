// Type shim for djiag-storage.js (CommonJS). Vite/esbuild skip .js parsing
// when the .d.ts sibling is present.

export function isStorageStateFresh(filePath: string, maxAgeMs?: number): boolean;
export const DEFAULT_STORAGE_STATE_MAX_AGE_MS: number;