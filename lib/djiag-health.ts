/**
 * lib/djiag-health.ts
 *
 * XS1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H1).
 * Lógica pura de lectura/derivación del health del pipeline DJI AG.
 * Separada del route handler para que sea testeable sin mockear
 * `node:fs` (los dynamic imports en el route handler son difíciles
 * de interceptar limpiamente con vitest).
 *
 * Fuentes del health (Sprint E — Task 2):
 *   1. **Filesystem** (`djiag_exports/_health.json`) — usado en dev
 *      local y CI. Escrito por `scripts/run-pipeline.js` con
 *      `writeHealthFile`. No funciona en Vercel serverless porque
 *      el filesystem es ephemeral.
 *   2. **Postgres** (`djiag_health` table, singleton row id=1) —
 *      la fuente de verdad en serverless. Escrita por
 *      `scripts/run-pipeline.js` con `writeHealthToDb` (best effort
 *      — si la tabla no existe o la conexión falla, el pipeline no
 *      rompe, solo loguea warning).
 *
 * El route handler elige la fuente según el entorno:
 *   - `process.env.VERCEL` o `AWS_LAMBDA_FUNCTION_NAME` seteada →
 *     lee de DB.
 *   - Si no → lee del filesystem.
 *
 * Si la fuente preferida falla (tabla no existe, file corrupto,
 * etc.), `deriveResponse(null)` se encarga de mapear a
 * `status='unknown'`. NO se intenta fallback cruzado (DB → file o
 * viceversa) para mantener simple.
 *
 * Tres funciones puras (testeables sin mockear `node:fs`/`pg`):
 *   - `readHealthFile(filePath)`: lee del filesystem.
 *   - `readHealthFromDb(client)`: lee de la tabla `djiag_health`.
 *     Acepta un `pg.Client` o `pg.PoolClient` inyectable para tests.
 *   - `deriveResponse(health)`: convierte el health crudo en la
 *     respuesta que ve el frontend.
 *
 * `HealthResponse` es el shape que devuelve el endpoint.
 */

import { readFile } from "node:fs/promises";

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
 * Lee el archivo de health del filesystem. Devuelve `null` si:
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
 * Tipo mínimo del cliente de DB que necesitamos. Acepta un
 * `pg.Client`, `pg.PoolClient`, o cualquier objeto con `.query()`.
 * No importamos `pg` arriba para mantener este módulo usable desde
 * entornos donde `pg` no está instalado (e.g. el browser bundle).
 */
export interface DbQueryRunner {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * Lee el health de la tabla `djiag_health` (singleton row id=1).
 *
 * Devuelve `null` si:
 *   - la tabla no existe (migration no aplicada) → query tira
 *     `error.code === '42P01'` y devolvemos null.
 *   - no hay row (improbable: la migration hace seed) → 0 rows.
 *   - cualquier otro error (conexión, permisos) → null.
 *
 * NO tira. El caller mapea `null` a `status='unknown'`.
 *
 * Mapea las columnas de la DB al shape `PipelineHealth` que usa
 * `deriveResponse`. La tabla es 1 sola fila por diseño, así que
 * `LIMIT 1` es defensivo.
 */
export async function readHealthFromDb(
  client: DbQueryRunner
): Promise<PipelineHealth | null> {
  let result: { rows: unknown[] };
  try {
    result = await client.query(
      `SELECT last_run_at, last_run_status, last_successful_sync_at,
              flights_count, fumigations_count, lands_count, steps
       FROM djiag_health
       WHERE id = 1
       LIMIT 1`
    );
  } catch (err) {
    // Si la tabla no existe (42P01 = undefined_table) o cualquier
    // otro error de Postgres, devolvemos null. NO queremos que un
    // error de DB rompa el endpoint admin.
    // eslint-disable-next-line no-console
    console.warn(
      "[djiag-health] readHealthFromDb falló (devolviendo null):",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
  const row = result.rows[0] as
    | {
        last_run_at: Date | string | null;
        last_run_status: "ok" | "partial" | "failed" | "unknown" | null;
        last_successful_sync_at: Date | string | null;
        flights_count: number | null;
        fumigations_count: number | null;
        lands_count: number | null;
        steps: StepHealth[] | null;
      }
    | undefined;
  if (!row) return null;
  // Mapear columnas DB → shape PipelineHealth.
  return {
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : "",
    lastRunStatus:
      row.last_run_status === "ok" ||
      row.last_run_status === "partial" ||
      row.last_run_status === "failed"
        ? row.last_run_status
        : "ok",
    lastSuccessfulSyncAt: row.last_successful_sync_at
      ? new Date(row.last_successful_sync_at).toISOString()
      : null,
    steps: Array.isArray(row.steps) ? row.steps : [],
    totals: {
      flights: typeof row.flights_count === "number" ? row.flights_count : 0,
      fumigations:
        typeof row.fumigations_count === "number" ? row.fumigations_count : 0,
      lands: typeof row.lands_count === "number" ? row.lands_count : 0
    },
    version: 1
  };
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
