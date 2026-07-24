// tests/lib-djiag-health.test.ts
//
// Test unitario para lib/djiag-health.ts — funciones de lectura.
//
// Cubre:
//   - **readHealthFromDb(client)**: lee la fila singleton de la tabla
//     `djiag_health` y la mapea al shape `PipelineHealth`.
//     - Mapea columnas DB (snake_case) → shape (camelCase).
//     - Devuelve `null` si la tabla no existe (error.code 42P01).
//     - Devuelve `null` si no hay rows.
//     - Devuelve `null` ante cualquier error de DB (no crashea).
//   - **readHealthFile(filePath)**: cubierto en
//     tests/api-admin-djiag-health.test.ts (con tmpfiles en disco).
//   - **deriveResponse(health)**: cubierto en
//     tests/api-admin-djiag-health.test.ts.
//
// Estrategia: mockeamos el cliente de DB (`DbQueryRunner`) con
// `vi.fn().mockResolvedValue({ rows: [...] })`. Sin tocar Postgres
// real. Sin tocar filesystem.

import { describe, expect, it, vi } from "vitest";

import { readHealthFromDb, type DbQueryRunner } from "@/lib/djiag-health";

function makeMockClient(rows: unknown[], error?: Error): DbQueryRunner {
  return {
    query: error
      ? vi.fn().mockRejectedValueOnce(error)
      : vi.fn().mockResolvedValueOnce({ rows })
  };
}

describe("readHealthFromDb", () => {
  it("devuelve null si la tabla no existe (42P01 undefined_table)", async () => {
    const err = new Error("relation 'djiag_health' does not exist") as Error & {
      code?: string;
    };
    err.code = "42P01";
    const client = makeMockClient([], err);
    const result = await readHealthFromDb(client);
    expect(result).toBeNull();
  });

  it("devuelve null si la query tira cualquier otro error", async () => {
    const err = new Error("connection refused") as Error & { code?: string };
    err.code = "ECONNREFUSED";
    const client = makeMockClient([], err);
    const result = await readHealthFromDb(client);
    expect(result).toBeNull();
  });

  it("devuelve null si la query devuelve 0 rows", async () => {
    const client = makeMockClient([]);
    const result = await readHealthFromDb(client);
    expect(result).toBeNull();
  });

  it("mapea una fila DB válida al shape PipelineHealth (camelCase)", async () => {
    const now = new Date("2026-07-24T10:00:00.000Z");
    const lastSync = new Date("2026-07-24T09:50:00.000Z");
    const client = makeMockClient([
      {
        last_run_at: now,
        last_run_status: "ok",
        last_successful_sync_at: lastSync,
        flights_count: 5,
        fumigations_count: 2,
        lands_count: 1207,
        steps: [
          { order: 1, name: "scrape", status: "ok", durationMs: 1234 },
          { order: 2, name: "upsert", status: "ok", durationMs: 567 }
        ]
      }
    ]);
    const result = await readHealthFromDb(client);
    expect(result).not.toBeNull();
    expect(result?.lastRunAt).toBe(now.toISOString());
    expect(result?.lastRunStatus).toBe("ok");
    expect(result?.lastSuccessfulSyncAt).toBe(lastSync.toISOString());
    expect(result?.totals.flights).toBe(5);
    expect(result?.totals.fumigations).toBe(2);
    expect(result?.totals.lands).toBe(1207);
    expect(result?.steps).toHaveLength(2);
    expect(result?.steps[0]?.name).toBe("scrape");
    expect(result?.version).toBe(1);
  });

  it("acepta timestamps como string (Postgres a veces devuelve strings)", async () => {
    const client = makeMockClient([
      {
        last_run_at: "2026-07-24T10:00:00.000Z",
        last_run_status: "partial",
        last_successful_sync_at: null,
        flights_count: 3,
        fumigations_count: 1,
        lands_count: 1200,
        steps: []
      }
    ]);
    const result = await readHealthFromDb(client);
    expect(result?.lastRunAt).toBe("2026-07-24T10:00:00.000Z");
    expect(result?.lastRunStatus).toBe("partial");
    expect(result?.lastSuccessfulSyncAt).toBeNull();
  });

  it("mapea null counts a 0 en totals (no quedan nulls en el shape)", async () => {
    const client = makeMockClient([
      {
        last_run_at: new Date("2026-07-24T10:00:00.000Z"),
        last_run_status: "failed",
        last_successful_sync_at: null,
        flights_count: null,
        fumigations_count: null,
        lands_count: null,
        steps: null
      }
    ]);
    const result = await readHealthFromDb(client);
    expect(result?.totals.flights).toBe(0);
    expect(result?.totals.fumigations).toBe(0);
    expect(result?.totals.lands).toBe(0);
    expect(result?.steps).toEqual([]);
  });

  it("normaliza lastRunStatus desconocido a 'ok' (defensivo contra drift)", async () => {
    const client = makeMockClient([
      {
        last_run_at: new Date("2026-07-24T10:00:00.000Z"),
        last_run_status: "banana",
        last_successful_sync_at: null,
        flights_count: 0,
        fumigations_count: 0,
        lands_count: 0,
        steps: []
      }
    ]);
    const result = await readHealthFromDb(client);
    // El check de la DB debería bloquear este valor, pero si llega
    // acá, el mapeo defensivo lo convierte a 'ok' en vez de crashear
    // o propagar un string inválido a deriveResponse.
    expect(result?.lastRunStatus).toBe("ok");
  });

  it("ejecuta la query esperada con WHERE id = 1 LIMIT 1", async () => {
    const client = makeMockClient([
      {
        last_run_at: new Date(),
        last_run_status: "ok",
        last_successful_sync_at: new Date(),
        flights_count: 1,
        fumigations_count: 1,
        lands_count: 1,
        steps: []
      }
    ]);
    await readHealthFromDb(client);
    expect(client.query).toHaveBeenCalledTimes(1);
    const sql = (client.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/FROM djiag_health/);
    expect(sql).toMatch(/WHERE id = 1/);
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).toMatch(/last_run_at/);
    expect(sql).toMatch(/last_run_status/);
    expect(sql).toMatch(/last_successful_sync_at/);
  });
});
