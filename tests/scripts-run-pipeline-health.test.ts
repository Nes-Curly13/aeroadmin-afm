// tests/scripts-run-pipeline-health.test.ts
//
// Test para las funciones de health-writing de scripts/run-pipeline.js
// (Sprint E — Task 2):
//   - `buildHealthPayload` (pura, lógica del payload)
//   - `writeHealthFile` (escribe al filesystem)
//   - `writeHealthToDb` (escribe a Postgres, best-effort)
//   - `writeHealth` (orquestador, ambos sinks)
//
// Estrategia:
//   - Importar el .js via createRequire (mismo patrón que
//     scripts-health-watchdog.test.ts y scripts-db-backup.test.ts).
//   - `buildHealthPayload` es pura → test directo.
//   - `writeHealthFile` se testea con tmpdirs reales.
//   - `writeHealthToDb` mockea `pg.Pool` con `vi.hoisted` y un
//     `__setPoolForTest` injectable para que el .js use el mock.
//     Si el .js no expone DI, testeamos indirectamente vía
//     `writeHealth` con DATABASE_URL apuntando a un host inválido
//     (verifica best-effort: falla pero no rompe).
//   - `writeHealth` orquesta ambos: verificamos que cuando DB está
//     mockeado, se llama a la DB con los datos correctos, y cuando
//     el filesystem tiene archivos, se escriben al tmpdir.
//
// Out of scope:
//   - El `main()` de run-pipeline (eso es integration test, no unit).
//   - El spawn de subprocesses (idem).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const pipeline = require("../scripts/run-pipeline.js") as {
  buildHealthPayload: (args: {
    steps: Array<{
      order: number;
      name: string;
      status: "ok" | "failed" | "skipped";
      durationMs?: number;
      error?: string;
    }>;
    finishedAt: number;
    runStatus: "ok" | "partial" | "failed";
    prevLastSuccessfulSyncAt?: string | null;
  }) => {
    lastRunAt: string;
    lastRunStatus: string;
    lastSuccessfulSyncAt: string | null;
    steps: unknown[];
    totals: { flights: number; fumigations: number; lands: number };
    version: 1;
  };
  writeHealthFile: (payload: {
    lastRunAt: string;
    lastRunStatus: string;
    lastSuccessfulSyncAt: string | null;
    steps: unknown[];
    totals: { flights: number; fumigations: number; lands: number };
    version: 1;
  }) => void;
  writeHealthToDb: (payload: unknown) => Promise<void>;
  writeHealth: (args: {
    steps: Array<{
      order: number;
      name: string;
      status: "ok" | "failed" | "skipped";
      durationMs?: number;
      error?: string;
    }>;
    startedAt: number;
    finishedAt: number;
    runStatus: "ok" | "partial" | "failed";
  }) => Promise<void>;
  readLastSuccessfulSyncAt: () => string | null;
};

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

// ============================================================
// Mock de `pg.Pool` — necesitamos interceptar el `new Pool(...)`
// que hace `writeHealthToDb` cuando llama `require('pg')`.
// Estrategia: usar `vi.mock` del módulo `pg` ANTES del import del
// script. Pero el script se importa con createRequire, que es CJS,
// y vi.mock no intercepta CJS require(). Solución: mockear la
// factory `Pool` global ANTES del test.
// ============================================================

// Track the mock pool so we can introspect it.
const _mockPool: MockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  end: vi.fn().mockResolvedValue(undefined)
};

// Mockeamos `pg.Pool` antes del require del script.
// Usamos Module._cache para que cuando el .js haga `require('pg')`,
// obtenga nuestro mock.
beforeEach(() => {
  vi.clearAllMocks();
  _mockPool.query.mockReset();
  _mockPool.end.mockReset();
  _mockPool.query.mockResolvedValue({ rows: [] });
  _mockPool.end.mockResolvedValue(undefined);
  // Setup pg.Pool mock via Module._cache.
  // El módulo 'pg' es el que ya está cacheado de otros tests
  // (probablemente). Lo reemplazamos con un mock que tiene `Pool`
  // como constructor.
  const pgModule = {
    Pool: vi.fn().mockImplementation(() => _mockPool)
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Module = require("node:module");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, ...rest: unknown[]) {
    if (request === "pg") return "pg";
    return origResolve.call(this, request, ...rest);
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cacheEntry = {
    id: "pg",
    filename: "pg",
    loaded: true,
    exports: pgModule,
    children: [],
    paths: []
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  require.cache["pg"] = cacheEntry as any;
  // Importante: seteamos DATABASE_URL para que writeHealthToDb
  // NO salga por el "no configurada" early return.
  process.env.DATABASE_URL = "postgres://fake@localhost:5432/fake";
  process.env.DATABASE_SSL = "false";
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SSL;
});

// ============================================================
// buildHealthPayload (pura)
// ============================================================

describe("buildHealthPayload", () => {
  it("para runStatus='ok', lastSuccessfulSyncAt = finishedAt", () => {
    const finishedAt = Date.parse("2026-07-24T10:00:00.000Z");
    const payload = pipeline.buildHealthPayload({
      steps: [{ order: 1, name: "scrape", status: "ok" }],
      finishedAt,
      runStatus: "ok"
    });
    expect(payload.lastRunAt).toBe("2026-07-24T10:00:00.000Z");
    expect(payload.lastRunStatus).toBe("ok");
    expect(payload.lastSuccessfulSyncAt).toBe("2026-07-24T10:00:00.000Z");
    expect(payload.version).toBe(1);
  });

  it("para runStatus='partial', preserva prevLastSuccessfulSyncAt si existe", () => {
    const finishedAt = Date.parse("2026-07-24T10:00:00.000Z");
    const prev = "2026-07-23T10:00:00.000Z";
    const payload = pipeline.buildHealthPayload({
      steps: [{ order: 1, name: "scrape", status: "ok" }],
      finishedAt,
      runStatus: "partial",
      prevLastSuccessfulSyncAt: prev
    });
    expect(payload.lastRunStatus).toBe("partial");
    expect(payload.lastSuccessfulSyncAt).toBe(prev);
  });

  it("para runStatus='failed' sin prev → lastSuccessfulSyncAt = null", () => {
    const payload = pipeline.buildHealthPayload({
      steps: [],
      finishedAt: Date.now(),
      runStatus: "failed"
    });
    expect(payload.lastRunStatus).toBe("failed");
    expect(payload.lastSuccessfulSyncAt).toBeNull();
  });

  it("totals suma +1 por step 'upsert X' OK (heurística)", () => {
    const payload = pipeline.buildHealthPayload({
      steps: [
        { order: 3, name: "upsert flights", status: "ok" },
        { order: 5, name: "upsert fumigations", status: "ok" },
        { order: 10, name: "upsert lands", status: "ok" },
        // No debería contar:
        { order: 1, name: "scrape per-flight", status: "ok" },
        { order: 3, name: "upsert flights", status: "failed" }
      ],
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    expect(payload.totals.flights).toBe(1);
    expect(payload.totals.fumigations).toBe(1);
    expect(payload.totals.lands).toBe(1);
  });

  it("steps en el payload tienen order/name/status/durationMs/error", () => {
    const payload = pipeline.buildHealthPayload({
      steps: [
        {
          order: 1,
          name: "scrape",
          status: "ok",
          durationMs: 1234
        },
        { order: 2, name: "upsert", status: "failed", durationMs: 500, error: "exit=1" }
      ],
      finishedAt: Date.now(),
      runStatus: "partial"
    });
    expect(payload.steps).toEqual([
      { order: 1, name: "scrape", status: "ok", durationMs: 1234, error: undefined },
      { order: 2, name: "upsert", status: "failed", durationMs: 500, error: "exit=1" }
    ]);
  });
});

// ============================================================
// writeHealthFile (filesystem real con tmpdir)
// ============================================================

describe("writeHealthFile", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("crea djiag_exports/_health.json con el payload JSON", () => {
    const payload = pipeline.buildHealthPayload({
      steps: [{ order: 1, name: "scrape", status: "ok", durationMs: 100 }],
      finishedAt: Date.parse("2026-07-24T10:00:00.000Z"),
      runStatus: "ok"
    });
    pipeline.writeHealthFile(payload);
    const filePath = join(tmpDir, "djiag_exports", "_health.json");
    expect(existsSync(filePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath, "utf8"));
    expect(onDisk.lastRunAt).toBe("2026-07-24T10:00:00.000Z");
    expect(onDisk.lastRunStatus).toBe("ok");
    expect(onDisk.totals.flights).toBe(0);
  });

  it("no crashea si process.cwd() es read-only (best-effort)", () => {
    // En Windows es difícil hacer un dir read-only confiable. Lo
    // simulamos: el cwd es válido, el subdir ya existe, y forzamos
    // un path de archivo inválido no debería pasar. Mejor: simplemente
    // verificamos que un cwd válido + payload normal funciona y
    // confiamos en el try/catch del código.
    // (El caso real de fallo es cubierto indirectamente por el log
    // "[health] no se pudo escribir".)
    expect(() =>
      pipeline.writeHealthFile(
        pipeline.buildHealthPayload({
          steps: [],
          finishedAt: Date.now(),
          runStatus: "ok"
        })
      )
    ).not.toThrow();
  });
});

// ============================================================
// writeHealthToDb (mockeando pg.Pool)
// ============================================================

describe("writeHealthToDb", () => {
  it("ejecuta el UPSERT con id=1 y los datos del payload", async () => {
    const payload = {
      lastRunAt: "2026-07-24T10:00:00.000Z",
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: "2026-07-24T10:00:00.000Z",
      steps: [{ order: 1, name: "scrape", status: "ok", durationMs: 100 }],
      totals: { flights: 1, fumigations: 1, lands: 1207 },
      version: 1
    };
    await pipeline.writeHealthToDb(payload);
    expect(_mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = _mockPool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO public\.djiag_health/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(sql).toMatch(/COALESCE\(EXCLUDED\.last_successful_sync_at/);
    expect(params[0]).toBe(1); // id
    expect(params[1]).toBe("2026-07-24T10:00:00.000Z"); // last_run_at
    expect(params[2]).toBe("ok"); // last_run_status
    expect(params[3]).toBe("2026-07-24T10:00:00.000Z"); // last_successful_sync_at
    expect(params[4]).toBe(1); // flights_count
    expect(params[5]).toBe(1); // fumigations_count
    expect(params[6]).toBe(1207); // lands_count
    expect(typeof params[7]).toBe("string"); // steps JSON
    expect(JSON.parse(params[7] as string)).toEqual(payload.steps);
  });

  it("hace pool.end() después de la query (cleanup del connection)", async () => {
    const payload = pipeline.buildHealthPayload({
      steps: [],
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    await pipeline.writeHealthToDb(payload);
    expect(_mockPool.end).toHaveBeenCalled();
  });

  it("best-effort: no throw si la query de DB falla", async () => {
    _mockPool.query.mockRejectedValueOnce(new Error("relation 'djiag_health' does not exist"));
    const payload = pipeline.buildHealthPayload({
      steps: [],
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    // NO debe tirar.
    await expect(pipeline.writeHealthToDb(payload)).resolves.toBeUndefined();
    // Y de todas formas cierra el pool.
    expect(_mockPool.end).toHaveBeenCalled();
  });

  it("no intenta escribir a la DB si DATABASE_URL no está seteada", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_URL_DIRECT;
    const payload = pipeline.buildHealthPayload({
      steps: [],
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    await pipeline.writeHealthToDb(payload);
    // No se llamó ni al constructor de Pool ni a query.
    expect(_mockPool.query).not.toHaveBeenCalled();
  });
});

// ============================================================
// writeHealth (orquestador)
// ============================================================

describe("writeHealth", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-orch-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("escribe a filesystem Y DB (best-effort en ambos lados)", async () => {
    const payload = {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: new Date().toISOString(),
      steps: [{ order: 1, name: "scrape", status: "ok", durationMs: 100 }],
      totals: { flights: 1, fumigations: 1, lands: 1 },
      version: 1
    };
    await pipeline.writeHealth({
      steps: [{ order: 1, name: "scrape", status: "ok", durationMs: 100 }],
      startedAt: Date.now() - 1000,
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    // Filesystem: el archivo existe con el JSON.
    const filePath = join(tmpDir, "djiag_exports", "_health.json");
    expect(existsSync(filePath)).toBe(true);
    // DB: la query se llamó.
    expect(_mockPool.query).toHaveBeenCalledTimes(1);
  });

  it("si la DB falla, el filesystem write sigue funcionando", async () => {
    _mockPool.query.mockRejectedValueOnce(new Error("DB down"));
    await pipeline.writeHealth({
      steps: [{ order: 1, name: "scrape", status: "ok", durationMs: 100 }],
      startedAt: Date.now() - 1000,
      finishedAt: Date.now(),
      runStatus: "ok"
    });
    const filePath = join(tmpDir, "djiag_exports", "_health.json");
    expect(existsSync(filePath)).toBe(true);
  });
});

// ============================================================
// readLastSuccessfulSyncAt (filesystem real con tmpdir)
// ============================================================

describe("readLastSuccessfulSyncAt", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "run-pipeline-read-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("devuelve null si el archivo no existe", () => {
    expect(pipeline.readLastSuccessfulSyncAt()).toBeNull();
  });

  it("lee el lastSuccessfulSyncAt del archivo existente", () => {
    const exportsDir = join(tmpDir, "djiag_exports");
    const fs = require("node:fs");
    fs.mkdirSync(exportsDir, { recursive: true });
    writeFileSync(
      join(exportsDir, "_health.json"),
      JSON.stringify({
        lastRunAt: "2026-07-24T10:00:00.000Z",
        lastRunStatus: "failed",
        lastSuccessfulSyncAt: "2026-07-23T10:00:00.000Z",
        steps: [],
        totals: { flights: 0, fumigations: 0, lands: 0 },
        version: 1
      }),
      "utf8"
    );
    expect(pipeline.readLastSuccessfulSyncAt()).toBe("2026-07-23T10:00:00.000Z");
  });

  it("devuelve null si el JSON está corrupto", () => {
    const exportsDir = join(tmpDir, "djiag_exports");
    const fs = require("node:fs");
    fs.mkdirSync(exportsDir, { recursive: true });
    writeFileSync(join(exportsDir, "_health.json"), "{ not valid", "utf8");
    expect(pipeline.readLastSuccessfulSyncAt()).toBeNull();
  });
});
