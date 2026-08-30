// lib/djiag-health.ts
//
// v2.1 (S7.2 hotfix) — este archivo quedó con SOLO las funciones que
// tocan Node (`readHealthFile`, `readHealthFromDb`). Los types y la
// función pura `deriveResponse` viven en `lib/djiag-health-types.ts`
// para que los Client Components puedan importarlos sin bundlear
// `node:fs/promises`.
//
// Por qué el split:
//
// `dashboard-v0-client.tsx` ("use client") y `health-panel.tsx`
// (que se importa desde el client) hacen `import type { HealthResponse,
// StepHealth } from "@/lib/djiag-health"`. Aunque sea `import type`,
// Turbopack no puede tree-shakear el `import { readFile } from
// "node:fs/promises"` de arriba de este archivo (es un side-effect
// top-level usado por `readHealthFile`). Resultado: el cliente
// intenta bundlear `node:fs/promises` y revienta con "the chunking
// context (unknown) does not support external modules".
//
// Solución:
//   - types + `deriveResponse` → `lib/djiag-health-types.ts` (puro,
//     safe para client).
//   - `readHealthFile` + `readHealthFromDb` → ACÁ (Node-only).
//   - Este archivo re-exporta los types desde el nuevo módulo para
//     no romper los imports server-side existentes (route handler,
//     scripts, tests).
//
// XS1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H1). Ver docstring
// completo en `lib/djiag-health-types.ts` para la historia de las
// fuentes del health.

import { readFile } from "node:fs/promises";

// Re-exports para mantener compatibilidad con imports existentes.
export {
  deriveResponse,
  type HealthResponse,
  type PipelineHealth
} from "@/lib/djiag-health-types";

/**
 * Lee el archivo de health del filesystem. Devuelve `null` si:
 *   - el archivo no existe
 *   - el archivo existe pero el JSON está corrupto
 *   - el archivo existe pero no es un objeto
 *
 * En cualquier caso, no tira error — el caller mapea `null` a
 * `status: 'unknown'`.
 */
export async function readHealthFile(filePath: string): Promise<import("@/lib/djiag-health-types").PipelineHealth | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as import("@/lib/djiag-health-types").PipelineHealth;
  } catch {
    return null;
  }
}

/**
 * Lee la sección `circuitBreaker` del archivo de health.
 *
 * S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2). El circuit breaker
 * del cliente DJI persiste su state en la sección `circuitBreaker`
 * de `djiag_exports/_health.json` (mismo archivo que `readHealthFile`).
 * Esta función expone ese state a los consumers (admin panel,
 * orchestrator pre-flight check, etc.) sin tener que parsear el
 * JSON completo.
 *
 * Devuelve `null` si:
 *   - el archivo no existe
 *   - el JSON está corrupto
 *   - la sección `circuitBreaker` no está presente (nunca se intentó
 *     login contra DJI en este filesystem)
 *   - la sección existe pero el shape es inválido (campo `state` no
 *     es uno de los 3 valores conocidos, etc.)
 *
 * No tira error. El caller decide cómo tratar el `null`:
 *   - Orchestrator (run-pipeline.js): `null === { state: 'closed' }` → OK
 *   - Admin panel: mostrar "circuit breaker: never used" o similar
 *
 * NO muta el filesystem. La función es read-only; para reset/abrir
 * el circuit, usar `CircuitBreaker` de `lib/djiag-circuit-breaker.js`
 * directamente.
 */
export async function getCircuitBreakerState(
  filePath: string
): Promise<import("@/lib/djiag-health-types").CircuitBreakerSnapshot | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const cb = (parsed as { circuitBreaker?: unknown }).circuitBreaker;
    if (!cb || typeof cb !== "object") return null;
    const obj = cb as Record<string, unknown>;
    // Validar shape mínimo. Si el state no es uno de los 3 conocidos,
    // descartar la sección entera (asumimos corrupción / versión
    // incompatible del módulo circuit-breaker).
    const state = obj.state;
    if (state !== "closed" && state !== "open" && state !== "half-open") {
      return null;
    }
    return {
      state,
      failureCount:
        typeof obj.failureCount === "number" && Number.isFinite(obj.failureCount)
          ? obj.failureCount
          : 0,
      openedAt: typeof obj.openedAt === "string" ? obj.openedAt : null,
      lastFailureAt:
        typeof obj.lastFailureAt === "string" ? obj.lastFailureAt : null,
      failureThreshold:
        typeof obj.failureThreshold === "number" && Number.isFinite(obj.failureThreshold)
          ? obj.failureThreshold
          : 3,
      resetTimeoutMs:
        typeof obj.resetTimeoutMs === "number" && Number.isFinite(obj.resetTimeoutMs)
          ? obj.resetTimeoutMs
          : 5 * 60 * 1000
    };
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
): Promise<import("@/lib/djiag-health-types").PipelineHealth | null> {
  let result: { rows: unknown[] };
  try {
    result = await client.query(
      `SELECT last_run_at, last_run_status, last_successful_sync_at,
              flights_count, fumigations_count, lands_count, steps,
              circuit_breaker
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
        steps: import("@/lib/djiag-health-types").StepHealth[] | null;
        circuit_breaker:
          | import("@/lib/djiag-health-types").CircuitBreakerSnapshot
          | null;
      }
    | undefined;
  if (!row) return null;
  // Mapear columnas DB → shape PipelineHealth.
  // `circuit_breaker` se valida con la misma lógica que
  // `getCircuitBreakerState()` (state ∈ {closed, open, half-open}),
  // para que el shape servido sea consistente venga del filesystem
  // o de la DB. Si el shape no matchea, descartamos la sección y
  // devolvemos null (mismo comportamiento defensivo).
  const circuitBreaker = normalizeCircuitBreaker(row.circuit_breaker);
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
    circuitBreaker,
    version: 1
  };
}

/**
 * Valida y normaliza el shape `CircuitBreakerSnapshot`. Devuelve `null`
 * si la sección no existe, no es un objeto, o el `state` no es uno de
 * los 3 valores conocidos.
 *
 * Lógica equivalente a `getCircuitBreakerState()` (filesystem), pero
 * operando sobre un valor en memoria en vez de un file path.
 * Centralizada acá para que ambos paths (filesystem + DB) devuelvan
 * el mismo shape — si el contrato cambia, se cambia en un solo lugar.
 */
function normalizeCircuitBreaker(
  raw: unknown
): import("@/lib/djiag-health-types").CircuitBreakerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const state = obj.state;
  if (state !== "closed" && state !== "open" && state !== "half-open") {
    return null;
  }
  return {
    state,
    failureCount:
      typeof obj.failureCount === "number" && Number.isFinite(obj.failureCount)
        ? obj.failureCount
        : 0,
    openedAt: typeof obj.openedAt === "string" ? obj.openedAt : null,
    lastFailureAt:
      typeof obj.lastFailureAt === "string" ? obj.lastFailureAt : null,
    failureThreshold:
      typeof obj.failureThreshold === "number" &&
      Number.isFinite(obj.failureThreshold)
        ? obj.failureThreshold
        : 3,
    resetTimeoutMs:
      typeof obj.resetTimeoutMs === "number" &&
      Number.isFinite(obj.resetTimeoutMs)
        ? obj.resetTimeoutMs
        : 5 * 60 * 1000
  };
}
