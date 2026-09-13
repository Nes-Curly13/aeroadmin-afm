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
 * Refresca fumigaciones y schedule. Retorna stats.
 *
 * Estrategia:
 *   1. backfillFumigationsFromFlights (re-agrupa flights → fumigaciones)
 *   2. updateFumigationSchedule (re-calcula last_fumigation_date +
 *      next_due_date)
 *
 * **La transacción la maneja el CALLER** (abre el cliente del pool,
 * BEGIN/COMMIT/ROLLBACK). Esta función solo orquesta los pasos; no abre
 * ni cierra transacción. `deps` permite inyectar los pasos para tests.
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
