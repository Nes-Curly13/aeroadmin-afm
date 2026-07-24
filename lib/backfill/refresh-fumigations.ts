// lib/backfill/refresh-fumigations.ts
//
// Sprint H2 — Orquestador del backfill end-to-end.
//
// Encapsula el patrón "recalcular fumigaciones desde flights +
// recalcular schedule" en una sola transacción. Es el "refresh" que
// reemplaza al script CLI `scripts/refresh-fumigations.js`.
//
// Usos:
//   - Endpoint admin: POST /api/admin/backfill-fumigations
//     (el pipeline CLI lo llama via HTTP al final del import).
//   - Tests: dependency injection via `deps` para mockear las
//     funciones puras sin tocar la BD.

import { getDb } from "@/lib/db";
import {
  backfillFumigationsFromFlights,
  type QueryRunner
} from "./fumigations-from-flights";
import { updateFumigationSchedule } from "./update-fumigation-schedule";

// Re-export para mantener la superficie pública coherente
// (todos los módulos de `lib/backfill/` exponen QueryRunner).
export type { QueryRunner };

/**
 * Dependencias inyectables de refreshFumigations. En producción
 * se usan los defaults (las funciones reales). En tests se
 * inyectan mocks para verificar el orden y el manejo de errores
 * sin tocar la BD.
 */
export interface RefreshDeps {
  backfillFumigationsFromFlights?: typeof backfillFumigationsFromFlights;
  updateFumigationSchedule?: typeof updateFumigationSchedule;
}

export interface RefreshStats {
  backfilled: number;
  deleted: number;
  scheduleUpdated: number;
  durationMs: number;
}

/**
 * Refresca fumigaciones y schedule en una transacción. Retorna
 * stats.
 *
 * Estrategia:
 *   1. BEGIN tx
 *   2. backfillFumigationsFromFlights (re-agrupa flights → fumigations)
 *   3. updateFumigationSchedule (re-calcula last_fumigation_date +
 *      next_due_date)
 *   4. COMMIT
 *
 * Si cualquier paso falla → ROLLBACK y la excepción propaga.
 *
 * `deps` permite inyectar los pasos para tests. En producción se
 * usan los defaults (las funciones reales).
 */
export async function refreshFumigations(
  client?: QueryRunner,
  deps: RefreshDeps = {}
): Promise<RefreshStats> {
  const backfill = deps.backfillFumigationsFromFlights ?? backfillFumigationsFromFlights;
  const update = deps.updateFumigationSchedule ?? updateFumigationSchedule;

  const startedAt = Date.now();
  const backfillStats = await backfill(client);
  const scheduleStats = await update(client);

  return {
    backfilled: backfillStats.inserted,
    deleted: backfillStats.deleted,
    scheduleUpdated: scheduleStats.updated,
    durationMs: Date.now() - startedAt
  };
}

/**
 * Wrapper de alto nivel que abre un cliente del pool, hace
 * BEGIN/COMMIT/ROLLBACK, y delega a `refreshFumigations`.
 *
 * Pensado para el endpoint admin (route handler). NO se usa desde
 * el script CLI (que llama al endpoint HTTP en vez de tocar la BD
 * directo).
 */
export async function refreshFumigationsInTransaction(): Promise<RefreshStats> {
  const pool = getDb();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await refreshFumigations(client as unknown as QueryRunner);
    await client.query("COMMIT");
    return stats;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // Si el ROLLBACK también falla (conexión muerta), no
      // ocultamos el error original — la query que lo causó es
      // más informativa para el caller.
    });
    throw err;
  } finally {
    client.release();
  }
}
