// lib/backfill/fumigations-from-flights.ts
//
// Sprint H2 — TS port del backfill CLI `scripts/backfill-fumigations-from-flights.js`.
//
// Re-agrupa los flights por (parcel_id, fecha local Colombia) y
// re-inserta en dji_fumigations con source='import' + flight_ids[].
//
// Idempotente: borra las filas con source='import' AND parcel_id
// IS NOT NULL antes de re-insertar (las agregadas con parcel_id
// NULL y las manuales con source='manual' no se tocan).
//
// Por qué este approach es mejor que las aggregate imports:
//   - Las aggregate imports (dji_fumigations con parcel_id NULL) son
//     totales diarios para TODA la cuenta — no sabemos qué parcela
//     específica.
//   - Ahora que dji_flights tiene parcel_id (vía spatial join),
//     podemos derivar eventos per-parcel con el desglose por
//     dron/piloto y la trazabilidad flight → fumigación.

import { getDb } from "@/lib/db";

/**
 * Tipo mínimo que la función necesita del client/pool de pg.
 * Evita acoplar los tests a `pg.PoolClient` (que tiene 50+ métodos
 * que el mock no necesita).
 */
export type QueryRunner = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rowCount: number; rows: unknown[] }>;
};

export interface BackfillStats {
  inserted: number;
  deleted: number;
}

/**
 * Mapea drone_nickname (humano) a dji_drone_models.code.
 * Ver dji_drone_models en migration 20260617170000:
 *   0=Sin asignar, 72=T16/T20, 201=T40/T50, 210=T70
 */
export function droneCodeFromNickname(nickname: string | null | undefined): number | null {
  if (!nickname) return null;
  const n = nickname.toLowerCase();
  if (n.includes("t40") || n.includes("t50")) return 201;
  if (n.includes("t16") || n.includes("t20")) return 72;
  if (n.includes("t70")) return 210;
  return 0; // Sin asignar
}

/**
 * Backfill desde dji_flights. Devuelve stats.
 *
 * Estrategia:
 *   1. DELETE rows con source='import' AND parcel_id IS NOT NULL
 *      (las aggregate con parcel_id NULL y las manuales con
 *      source='manual' no se tocan). Idempotente.
 *   2. INSERT nuevos rows agrupados por (parcel_id, local_date)
 *   3. Solo flights con parcel_id IS NOT NULL (los unmatched quedan
 *      fuera — son las huérfanas de admin manual).
 *
 * Acepta un QueryRunner opcional para tests. Si no se pasa, usa el
 * pool de getDb() (producción). El caller es responsable del
 * BEGIN/COMMIT — esta función NO maneja la transacción (la usa
 * `refreshFumigations` que es el orquestador).
 */
export async function backfillFumigationsFromFlights(
  client?: QueryRunner
): Promise<BackfillStats> {
  const db = client ?? getDb();

  // 1. Borrar filas previas del backfill.
  const del = await db.query(
    `DELETE FROM dji_fumigations
     WHERE source = 'import'
       AND parcel_id IS NOT NULL`
  );
  const deleted = del.rowCount ?? 0;

  // 2. Insertar nuevas filas agrupadas.
  //    DATE(start_at AT TIME ZONE 'America/Bogota') = fecha local
  //    del vuelo (importante: Colombia UTC-5, no UTC).
  const ins = await db.query(`
    WITH agg AS (
      SELECT
        DATE(f.start_at AT TIME ZONE 'America/Bogota') AS fumigation_date,
        f.parcel_id,
        -- drone_nickname más frecuente del día
        (MODE() WITHIN GROUP (ORDER BY f.drone_nickname)) AS primary_drone_nickname,
        CASE
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t40%' THEN 201
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t50%' THEN 201
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t16%' THEN 72
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t20%' THEN 72
          WHEN LOWER((MODE() WITHIN GROUP (ORDER BY f.drone_nickname))::text) LIKE '%t70%' THEN 210
          ELSE 0
        END AS drone_code_used,
        SUM(f.area_m2)::numeric(12, 2) AS area_fumigated_m2,
        ROUND(SUM(f.duration_seconds) / 60.0)::int AS duration_minutes,
        CASE
          WHEN SUM(f.area_m2) > 0 THEN
            ROUND(((SUM(f.spray_usage_ml) / 1000.0) / (SUM(f.area_m2) / 10000.0))::numeric, 2)
          ELSE NULL
        END AS dose_l_per_ha,
        COUNT(*)::int AS flights_count,
        SUM(f.spray_usage_ml)::int AS total_spray_ml,
        array_agg(DISTINCT f.drone_nickname) AS drones,
        array_agg(DISTINCT f.pilot_name) FILTER (WHERE f.pilot_name IS NOT NULL) AS pilots,
        (MODE() WITHIN GROUP (ORDER BY f.pilot_name)) AS primary_pilot,
        -- Sprint G2: array de flight IDs que originaron esta fumigación.
        -- Permite el "ver qué flights usó esta fumigación" en el UI
        -- de la hoja de vida. array_agg sin DISTINCT porque pueden
        -- repetirse si el mismo flight_id aparece en varias rows
        -- (defensa). ORDER BY para que el array sea determinístico.
        array_agg(f.id ORDER BY f.id) AS flight_ids
      FROM dji_flights f
      WHERE f.parcel_id IS NOT NULL
        AND f.start_at IS NOT NULL
      GROUP BY f.parcel_id, DATE(f.start_at AT TIME ZONE 'America/Bogota')
    )
    INSERT INTO dji_fumigations (
      fumigation_date, parcel_id, drone_code_used,
      area_fumigated_m2, duration_minutes, dose_l_per_ha,
      notes, recorded_by, source, flight_ids
    )
    SELECT
      fumigation_date, parcel_id, drone_code_used,
      area_fumigated_m2, duration_minutes, dose_l_per_ha,
      jsonb_build_object(
        'backfilled_from', 'dji_flights',
        'flights_count', flights_count,
        'spray_usage_ml', total_spray_ml,
        'drones', drones,
        'pilots', pilots,
        'primary_drone_nickname', primary_drone_nickname
      ),
      primary_pilot,
      'import',
      flight_ids
    FROM agg
    RETURNING id, fumigation_date, parcel_id
  `);

  return {
    inserted: ins.rowCount ?? 0,
    deleted,
  };
}
