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
//   - **getCircuitBreakerState(filePath)**: lee la sección
//     `circuitBreaker` del _health.json (Sprint H2, 2026-07-30).
//     - Devuelve `null` si el archivo no existe, está corrupto, o no
//       tiene la sección.
//     - Valida el shape mínimo (state ∈ {closed, open, half-open}).
//     - Normaliza campos opcionales con defaults razonables.
//
// Estrategia: mockeamos el cliente de DB (`DbQueryRunner`) con
// `vi.fn().mockResolvedValue({ rows: [...] })`. Sin tocar Postgres
// real. Para `getCircuitBreakerState` usamos tmpfiles en disco.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readHealthFromDb, getCircuitBreakerState, type DbQueryRunner } from "@/lib/djiag-health";

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

// ============================================================
// getCircuitBreakerState (Sprint H2, 2026-07-30)
// Lee la sección circuitBreaker de djiag_exports/_health.json.
// ============================================================

describe("getCircuitBreakerState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-cb-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("devuelve null si el archivo no existe", async () => {
    const r = await getCircuitBreakerState(join(tmpDir, "missing.json"));
    expect(r).toBeNull();
  });

  it("devuelve null si el JSON está corrupto", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, "{ not valid", "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).toBeNull();
  });

  it("devuelve null si el archivo no es un objeto (es un array)", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, "[]", "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).toBeNull();
  });

  it("devuelve null si no hay sección circuitBreaker", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      lastRunAt: "2026-07-22T00:00:00.000Z",
      lastRunStatus: "ok"
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).toBeNull();
  });

  it("devuelve null si el state tiene un valor inválido (no es uno de los 3)", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      circuitBreaker: { state: "broken", failureCount: 1, openedAt: null }
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).toBeNull();
  });

  it("lee un circuit cerrado (state=closed, failureCount=0)", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      lastRunAt: "2026-07-22T00:00:00.000Z",
      circuitBreaker: {
        state: "closed",
        failureCount: 0,
        openedAt: null,
        lastFailureAt: null,
        failureThreshold: 3,
        resetTimeoutMs: 300000
      }
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).not.toBeNull();
    expect(r?.state).toBe("closed");
    expect(r?.failureCount).toBe(0);
    expect(r?.openedAt).toBeNull();
    expect(r?.failureThreshold).toBe(3);
    expect(r?.resetTimeoutMs).toBe(300000);
  });

  it("lee un circuit abierto (state=open, openedAt con timestamp)", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      lastRunAt: "2026-07-22T00:00:00.000Z",
      circuitBreaker: {
        state: "open",
        failureCount: 3,
        openedAt: "2026-07-22T10:00:00.000Z",
        lastFailureAt: "2026-07-22T10:00:00.000Z",
        failureThreshold: 3,
        resetTimeoutMs: 300000
      }
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r?.state).toBe("open");
    expect(r?.failureCount).toBe(3);
    expect(r?.openedAt).toBe("2026-07-22T10:00:00.000Z");
    expect(r?.lastFailureAt).toBe("2026-07-22T10:00:00.000Z");
  });

  it("normaliza campos faltantes con defaults (failureCount, failureThreshold, resetTimeoutMs)", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      circuitBreaker: { state: "half-open", openedAt: "2026-07-22T10:05:00.000Z" }
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r?.state).toBe("half-open");
    expect(r?.failureCount).toBe(0);
    expect(r?.lastFailureAt).toBeNull();
    expect(r?.failureThreshold).toBe(3);
    expect(r?.resetTimeoutMs).toBe(5 * 60 * 1000);
  });

  it("normaliza failureCount inválido (no es number) a 0", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({
      circuitBreaker: { state: "closed", failureCount: "not-a-number", openedAt: null }
    }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r?.failureCount).toBe(0);
  });

  it("no rompe si la sección circuitBreaker es null", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify({ circuitBreaker: null }), "utf8");
    const r = await getCircuitBreakerState(p);
    expect(r).toBeNull();
  });

  it("preserva el resto de las secciones (no las lee, no las muta)", async () => {
    // Sanity check: la función solo lee la sección circuitBreaker,
    // no toca el resto. (No hay writeFile en la implementación, así
    // que no puede mutar — pero verificamos que el filesystem sigue
    // intacto después de la lectura.)
    const p = join(tmpDir, "_health.json");
    const original = JSON.stringify({
      lastRunAt: "2026-07-22T10:00:00.000Z",
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: "2026-07-22T10:00:00.000Z",
      steps: [{ order: 1, name: "scrape", status: "ok" }],
      totals: { flights: 5, fumigations: 2, lands: 1207 },
      version: 1,
      circuitBreaker: { state: "closed", failureCount: 0, openedAt: null, lastFailureAt: null, failureThreshold: 3, resetTimeoutMs: 300000 }
    });
    writeFileSync(p, original, "utf8");
    await getCircuitBreakerState(p);
    // El archivo no fue tocado.
    const reloaded = JSON.parse((await import("node:fs")).readFileSync(p, "utf8"));
    expect(reloaded.lastRunAt).toBe("2026-07-22T10:00:00.000Z");
    expect(reloaded.totals.flights).toBe(5);
  });
});
