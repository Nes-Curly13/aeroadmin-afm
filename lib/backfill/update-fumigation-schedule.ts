// lib/backfill/update-fumigation-schedule.ts
//
// Sprint H2 — TS port del script CLI `scripts/update-fumigation-schedule.js`.
//
// Para cada fila activa en dji_fumigation_schedule:
//   - last_fumigation_date = MAX(dji_fumigations.fumigation_date) WHERE parcel_id
//   - next_due_date = last_fumigation_date + recommended_cadence_days
//
// Idempotente: corre N veces = mismo resultado.

import { getDb } from "@/lib/db";
import type { QueryRunner } from "./fumigations-from-flights";

export interface ScheduleUpdateRow {
  id: number;
  parcel_id: number;
  last_fumigation_date: Date | null;
  next_due_date: Date | null;
}

export interface ScheduleUpdateStats {
  updated: number;
}

/**
 * Recalcula `dji_fumigation_schedule.last_fumigation_date` y
 * `next_due_date` desde los datos reales de `dji_fumigations`.
 *
 * El query hace un UPDATE con `FROM (last_fum) WHERE s.parcel_id =
 * lf.parcel_id` — un solo round-trip y filtra automáticamente las
 * filas del schedule que no tienen fumigaciones (no las toca).
 *
 * Acepta un QueryRunner opcional para tests. Si no se pasa, usa
 * el pool de `getDb()`. El caller es responsable del BEGIN/COMMIT
 * (lo hace `refreshFumigations` que es el orquestador).
 */
export async function updateFumigationSchedule(
  client?: QueryRunner
): Promise<ScheduleUpdateStats> {
  const db = client ?? getDb();
  const r = await db.query(`
    WITH last_fum AS (
      SELECT parcel_id, MAX(fumigation_date) AS last_date
      FROM dji_fumigations
      WHERE parcel_id IS NOT NULL
      GROUP BY parcel_id
    )
    UPDATE dji_fumigation_schedule s
    SET
      last_fumigation_date = lf.last_date,
      -- s.recommended_cadence_days es int; convertimos a interval con make_interval
      next_due_date = lf.last_date + make_interval(days => s.recommended_cadence_days)
    FROM last_fum lf
    WHERE s.parcel_id = lf.parcel_id
      AND s.is_active = true
    RETURNING s.id, s.parcel_id, s.last_fumigation_date, s.next_due_date
  `);
  return { updated: r.rowCount ?? 0 };
}
