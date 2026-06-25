// Tests para scripts/backfill-fumigations-from-flights.js — backfillFumigationsFromFlights
//
// Cubre:
//   - DELETE idempotente: borra solo source='import' AND parcel_id IS NOT NULL
//     (los aggregate con parcel_id NULL y los manuales con source='manual'
//     no se tocan).
//   - INSERT agrupa por (parcel_id, DATE(start_at AT TIME ZONE 'America/Bogota'))
//   - El CASE de drone_code mapea T40/T50/T16/T20/T70 → 201/201/72/72/210
//   - Retorna { inserted: rowCount }

import { describe, expect, it, vi } from "vitest";

import { backfillFumigationsFromFlights } from "@/scripts/backfill-fumigations-from-flights";

function makeMockClient(opts: {
  deleteRowCount?: number;
  insertRowCount?: number;
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const deleteRowCount = opts.deleteRowCount ?? 0;
  const insertRowCount = opts.insertRowCount ?? 0;
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.trim().toUpperCase().startsWith("DELETE")) {
        return { rowCount: deleteRowCount, rows: [] };
      }
      if (sql.trim().toUpperCase().startsWith("WITH")) {
        return { rowCount: insertRowCount, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    })
  };
  return { client: client as unknown as import("pg").PoolClient, calls };
}

describe("backfill-fumigations-from-flights — backfillFumigationsFromFlights", () => {
  it("DELETE filtra por source='import' AND parcel_id IS NOT NULL", async () => {
    const { client, calls } = makeMockClient();
    await backfillFumigationsFromFlights(client);

    const deleteCall = calls.find((c) => c.sql.trim().toUpperCase().startsWith("DELETE"));
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.sql).toMatch(/source\s*=\s*'import'/);
    expect(deleteCall!.sql).toMatch(/parcel_id IS NOT NULL/);
  });

  it("INSERT agrupa por (parcel_id, DATE(start_at AT TIME ZONE 'America/Bogota'))", async () => {
    const { client, calls } = makeMockClient();
    await backfillFumigationsFromFlights(client);

    const insertCall = calls.find((c) => c.sql.trim().toUpperCase().startsWith("WITH"));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toMatch(/GROUP BY f\.parcel_id, DATE\(f\.start_at AT TIME ZONE 'America\/Bogota'\)/);
  });

  it("el CASE de drone_code mapea T40/T50/T16/T20/T70", async () => {
    const { client, calls } = makeMockClient();
    await backfillFumigationsFromFlights(client);

    const insertSql = calls.find((c) => c.sql.trim().toUpperCase().startsWith("WITH"))!.sql;
    // T40 / T50 → 201
    expect(insertSql).toMatch(/LIKE '%t40%'.*THEN 201/s);
    expect(insertSql).toMatch(/LIKE '%t50%'.*THEN 201/s);
    // T16 / T20 → 72
    expect(insertSql).toMatch(/LIKE '%t16%'.*THEN 72/s);
    expect(insertSql).toMatch(/LIKE '%t20%'.*THEN 72/s);
    // T70 → 210
    expect(insertSql).toMatch(/LIKE '%t70%'.*THEN 210/s);
  });

  it("solo incluye flights con parcel_id IS NOT NULL en el aggregate", async () => {
    const { client, calls } = makeMockClient();
    await backfillFumigationsFromFlights(client);

    const insertSql = calls.find((c) => c.sql.trim().toUpperCase().startsWith("WITH"))!.sql;
    expect(insertSql).toMatch(/f\.parcel_id IS NOT NULL/);
  });

  it("inserta con source='import' (no pisa aggregate parcel_id=NULL ni manual)", async () => {
    const { client, calls } = makeMockClient();
    await backfillFumigationsFromFlights(client);

    const insertSql = calls.find((c) => c.sql.trim().toUpperCase().startsWith("WITH"))!.sql;
    // El SELECT del INSERT setea source directamente al literal 'import'
    // (no es un UPDATE — es INSERT ... SELECT).
    expect(insertSql).toMatch(/'import'/);
    // Y el filtro WHERE del aggregate excluye flights sin parcel_id
    expect(insertSql).toMatch(/parcel_id IS NOT NULL/);
  });

  it("retorna { inserted: rowCount }", async () => {
    const { client } = makeMockClient({ insertRowCount: 130 });
    const stats = await backfillFumigationsFromFlights(client);
    expect(stats.inserted).toBe(130);
  });

  it("loggea cuántas filas previas borró (idempotencia observable)", async () => {
    const { client } = makeMockClient({ deleteRowCount: 363, insertRowCount: 130 });
    // No assertion sobre console — pero verificamos que stats.inserted refleja el INSERT
    const stats = await backfillFumigationsFromFlights(client);
    expect(stats.inserted).toBe(130);
  });
});