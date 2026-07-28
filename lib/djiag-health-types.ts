// lib/djiag-health-types.ts
//
// v2.1 (S7.2 hotfix) — split de lib/djiag-health.ts.
//
// Por qué este archivo existe:
//
// `lib/djiag-health.ts` importa `node:fs/promises` a nivel de módulo
// (para `readHealthFile`). Ese side-effect import arriba del archivo
// hace que Turbopack NO pueda tree-shakear el módulo cuando un
// Client Component (`dashboard-v0-client.tsx`, `health-panel.tsx`)
// hace `import type { HealthResponse, StepHealth }` desde él.
//
// Resultado: el cliente intenta bundlear `node:fs/promises` y revienta
// con "the chunking context (unknown) does not support external
// modules".
//
// Solución: este archivo contiene SOLO types y funciones puras (sin
// ningún import Node-only). Los Client Components importan de acá.
// El archivo original (`lib/djiag-health.ts`) queda con las funciones
// que sí tocan fs/pg (`readHealthFile`, `readHealthFromDb`) y
// re-exporta estos types para que el código server-side (route
// handlers, scripts) siga funcionando sin cambios.

/** Shape del JSON que escribe `scripts/run-pipeline.js` al filesystem. */
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
