// Type shim for djiag-korean-client.js (CommonJS). Sin este shim,
// vite/esbuild parseean el .js directamente al importarlo desde tests,
// y los asteriscos en JSDoc ("**/mission") se confunden con globs.

declare const DjiagKoreanClient: any;
declare const loadEnvFromLocalFile: () => void;
declare const KOREAN_HOST: string;
declare const DEFAULT_BASE: string;
declare const DEFAULT_STORAGE_STATE_PATH: string;
declare const DEFAULT_STORAGE_STATE_MAX_AGE_MS: number;

export {
  DjiagKoreanClient,
  loadEnvFromLocalFile,
  KOREAN_HOST,
  DEFAULT_BASE,
  DEFAULT_STORAGE_STATE_PATH,
  DEFAULT_STORAGE_STATE_MAX_AGE_MS
};