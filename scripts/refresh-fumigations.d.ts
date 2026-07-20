// TypeScript declarations para scripts/refresh-fumigations.js (CommonJS).

/**
 * Tipo mínimo que la función necesita del client de pg.
 * Solo requiere `query(sql, params?) → { rowCount, rows }`.
 * Evita acoplar los tests a `pg.PoolClient` (que tiene 50+ métodos
 * que el mock no necesita).
 */
export type QueryRunner = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rowCount: number; rows: unknown[] }>;
};

/**
 * Dependencias inyectables de refreshFumigations. En producción se usan
 * los defaults (los módulos reales de backfill + update-schedule). En
 * tests se inyectan mocks para verificar el orden y el manejo de errores
 * sin tocar la BD.
 */
export type RefreshDeps = {
  backfillFumigationsFromFlights?: (client: QueryRunner) => Promise<{ inserted: number }>;
  updateSchedule?: (client: QueryRunner) => Promise<unknown[]>;
};

export declare function main(): Promise<void>;
export declare function refreshFumigations(
  client: QueryRunner,
  deps?: RefreshDeps
): Promise<{
  backfilled: number;
  scheduleUpdated: number;
  durationMs: number;
}>;
