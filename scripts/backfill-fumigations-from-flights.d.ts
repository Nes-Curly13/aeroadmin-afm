// TypeScript declarations para scripts/backfill-fumigations-from-flights.js (CommonJS).

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

export declare function main(): Promise<void>;
export declare function backfillFumigationsFromFlights(
  client: QueryRunner
): Promise<{ inserted: number }>;
export declare function droneCodeFromNickname(
  nickname: string | null | undefined
): number | null;
