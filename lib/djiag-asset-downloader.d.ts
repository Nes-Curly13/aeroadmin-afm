// TypeScript declarations for lib/djiag-asset-downloader.js
//
// (S1.6 / 2026-07-01) Helper puro JS sin compilación TS. Este shim expone
// la API a consumidores TS sin tener que importar el JS con @ts-ignore.

export const DEFAULT_KINDS: string[];

export function sanitizeExternalId(externalId: string | null | undefined): string;

export function buildAssetPath(
  outDir: string,
  externalId: string,
  kind: string
): string;

export interface AssetTask {
  externalId: string;
  landName: string | null;
  kind: string;
  url: string;
}

export function buildAssetIndex(
  lands: Array<{
    externalId?: string | null;
    name?: string | null;
    geometryUrl?: string | null;
    parameterUrl?: string | null;
    waypointUrl?: string | null;
  }>,
  kinds?: string[]
): AssetTask[];

export function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;

export function backoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number;

export interface FetchWithRetryOpts {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

export function fetchWithRetry(url: string, opts?: FetchWithRetryOpts): Promise<Response>;

export interface RunDownloadStats {
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors: Array<{
    externalId: string;
    kind: string;
    url: string;
    error: string;
  }>;
}

export interface RunDownloadOpts extends FetchWithRetryOpts {
  lands: unknown[];
  outDir: string;
  kinds?: string[];
  concurrency?: number;
  force?: boolean;
  logger?: { warn?: (msg: string) => void } | null;
}

export function runDownload(opts: RunDownloadOpts): Promise<RunDownloadStats>;