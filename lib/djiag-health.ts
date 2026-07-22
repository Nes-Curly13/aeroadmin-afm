/**
 * lib/djiag-health.ts
 *
 * XS1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H1).
 *
 * Lógica pura de lectura/derivación del health del pipeline DJI AG.
 * Separada del route handler para que sea testeable sin mockear
 * `node:fs` (los dynamic imports en el route handler son difíciles
 * de interceptar limpiamente con vitest).
 *
 * Tres funciones:
 *   - `readHealthFile(filePath)`: lee y parsea el JSON. null si no
 *     existe o está corrupto.
 *   - `deriveResponse(health)`: convierte el JSON crudo en la
 *     respuesta que ve el frontend (con status derivado, warnings,
 *     hoursSinceLastSync, etc.).
 *   - `HealthResponse`: el shape que devuelve el endpoint.
 *
 * No usa `process.cwd()` ni globals. El caller pasa el path absoluto
 * del archivo. Esto facilita los tests (pasamos un tmpfile) y
 * desacopla del layout del filesystem.
 */

import { readFile } from "node:fs/promises";

/** Shape del JSON que escribe `scripts/run-pipeline.js`. */
export interface PipelineHealth {
  lastRunAt: string;
  lastRunStatus: "ok" | "partial" | "failed";
  lastSuccessfulSyncAt: string | null;
  steps: StepHealth[];
  totals: {
    flights: number;
    fumigations: number;
    lands: number;
  };
  version: 1;
}

export interface StepHealth {
  order: number;
  name: string;
  status: "ok" | "failed" | "skipped";
  durationMs?: number;
  error?: string;
}

export type HealthStatus = "ok" | "partial" | "stale" | "unknown" | "failed";

export interface HealthResponse {
  status: HealthStatus;
  lastRunAt: string | null;
  lastRunStatus: PipelineHealth["lastRunStatus"] | "unknown";
  lastSuccessfulSyncAt: string | null;
  flightsLastSync: number | null;
  fumigationsLastSync: number | null;
  landsLastSync: number | null;
  hoursSinceLastSync: number | null;
  warnings: string[];
  steps: StepHealth[];
}

export const STALE_THRESHOLD_HOURS = 24;

/**
 * Lee el archivo de health. Devuelve `null` si:
 *   - el archivo no existe
 *   - el archivo existe pero el JSON está corrupto
 *   - el archivo existe pero no es un objeto
 *
 * En cualquier caso, no tira error — el caller mapea `null` a
 * `status: 'unknown'`.
 */
export async function readHealthFile(filePath: string): Promise<PipelineHealth | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PipelineHealth;
  } catch {
    return null;
  }
}

/**
 * Deriva la respuesta que ve el frontend. Función pura, sin side
 * effects. Toma el JSON crudo (o null) y devuelve el shape final.
 *
 * Reglas:
 *   - Sin health → status='unknown', todo null, 1 warning.
 *   - Health.ok + fresh (<24h) → status='ok'.
 *   - Health.ok + stale (>24h) → status='stale', 1 warning.
 *   - Health.partial → status='partial', 1 warning.
 *   - Health.failed → status='failed', 1 warning.
 */
export function deriveResponse(health: PipelineHealth | null): HealthResponse {
  if (!health) {
    return {
      status: "unknown",
      lastRunAt: null,
      lastRunStatus: "unknown",
      lastSuccessfulSyncAt: null,
      flightsLastSync: null,
      fumigationsLastSync: null,
      landsLastSync: null,
      hoursSinceLastSync: null,
      warnings: ["Archivo _health.json no existe o está corrupto."],
      steps: []
    };
  }

  const lastRunAt = health.lastRunAt ?? null;
  const lastSuccessfulSyncAt = health.lastSuccessfulSyncAt ?? null;
  const hoursSinceLastSync =
    lastSuccessfulSyncAt !== null
      ? Number(
          ((Date.now() - new Date(lastSuccessfulSyncAt).getTime()) / 3_600_000).toFixed(2)
        )
      : null;

  const warnings: string[] = [];
  if (
    hoursSinceLastSync !== null &&
    hoursSinceLastSync > STALE_THRESHOLD_HOURS
  ) {
    warnings.push(
      `Última sync exitosa hace ${hoursSinceLastSync}h (>${STALE_THRESHOLD_HOURS}h).`
    );
  }
  if (health.lastRunStatus === "failed") {
    warnings.push("La última corrida del pipeline falló.");
  }
  if (health.lastRunStatus === "partial") {
    warnings.push("La última corrida tuvo steps fallidos.");
  }

  const status: HealthStatus =
    health.lastRunStatus === "ok" &&
    (hoursSinceLastSync === null || hoursSinceLastSync <= STALE_THRESHOLD_HOURS)
      ? "ok"
      : health.lastRunStatus === "ok"
        ? "stale"
        : health.lastRunStatus;

  return {
    status,
    lastRunAt,
    lastRunStatus: health.lastRunStatus,
    lastSuccessfulSyncAt,
    flightsLastSync: health.totals?.flights ?? null,
    fumigationsLastSync: health.totals?.fumigations ?? null,
    landsLastSync: health.totals?.lands ?? null,
    hoursSinceLastSync,
    warnings,
    steps: Array.isArray(health.steps) ? health.steps : []
  };
}
