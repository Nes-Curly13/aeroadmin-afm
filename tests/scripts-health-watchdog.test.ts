// Tests para scripts/health-watchdog.js (Sprint C — H3b).
//
// Estrategia (misma que scripts-db-backup.test.ts):
//   - Importar el .js via createRequire. El script es CJS y los helpers
//     exportados son `loadLocalEnv`, `fetchHealth`, `evaluateHealth`,
//     `buildAuthHeaders`.
//   - `fetchHealth` acepta una función `fetchFn` inyectable (vitest no
//     intercepta `createRequire('node-fetch')` ni CJS `require()` de
//     manera confiable desde scripts CJS).
//   - `evaluateHealth` y `buildAuthHeaders` son funciones puras — se
//     testean directamente sin mocks.
//   - Los exit codes del `main()` están cubiertos indirectamente por
//     los tests de las primitivas.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const watchdog = require("../scripts/health-watchdog.js") as {
  loadLocalEnv: () => void;
  fetchHealth: (
    healthUrl: string,
    headers: Record<string, string>,
    fetchFn?: (
      url: string,
      init: Record<string, unknown>
    ) => Promise<{
      ok: boolean;
      status: number;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    }>,
    timeoutMs?: number
  ) => Promise<unknown>;
  evaluateHealth: (
    health: unknown,
    staleHours: number
  ) => { exitCode: 0 | 1; reason: string };
  buildAuthHeaders: (env?: Record<string, string | undefined>) => Record<string, string>;
};

describe("health-watchdog — buildAuthHeaders", () => {
  it("usa Authorization: Bearer cuando HEALTH_TOKEN está presente", () => {
    const headers = watchdog.buildAuthHeaders({ HEALTH_TOKEN: "secret-abc" });
    expect(headers.Authorization).toBe("Bearer secret-abc");
    expect(headers.Cookie).toBeUndefined();
  });

  it("usa Cookie cuando solo HEALTH_AUTH_COOKIE está presente (fallback legacy)", () => {
    const headers = watchdog.buildAuthHeaders({ HEALTH_AUTH_COOKIE: "next-auth.session-token=xyz" });
    expect(headers.Cookie).toBe("next-auth.session-token=xyz");
    expect(headers.Authorization).toBeUndefined();
  });

  it("prioriza HEALTH_TOKEN sobre HEALTH_AUTH_COOKIE (token es más simple)", () => {
    const headers = watchdog.buildAuthHeaders({
      HEALTH_TOKEN: "secret-abc",
      HEALTH_AUTH_COOKIE: "next-auth.session-token=xyz"
    });
    expect(headers.Authorization).toBe("Bearer secret-abc");
    expect(headers.Cookie).toBeUndefined();
  });

  it("sin token ni cookie, devuelve solo Accept (la request va a fallar 401)", () => {
    const headers = watchdog.buildAuthHeaders({});
    expect(headers).toEqual({ Accept: "application/json" });
  });
});

describe("health-watchdog — evaluateHealth (lógica pura)", () => {
  it("status='ok' → exit 0, reason menciona horas", () => {
    const r = watchdog.evaluateHealth(
      { status: "ok", hoursSinceLastSync: 2 },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/OK.*2h.*24h/);
  });

  it("status='ok' pero sin hoursSinceLastSync (caso edge) → exit 0", () => {
    const r = watchdog.evaluateHealth(
      { status: "ok", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/<1h/);
  });

  it("status='stale' → exit 1 con horas explícitas", () => {
    const r = watchdog.evaluateHealth(
      { status: "stale", hoursSinceLastSync: 48 },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/STALE.*48h.*24h/);
  });

  it("status='stale' respeta el threshold custom (HEALTH_STALE_HOURS=4)", () => {
    const r = watchdog.evaluateHealth(
      { status: "stale", hoursSinceLastSync: 27 },
      4
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/27h.*4h/);
  });

  it("status='partial' → exit 1 (steps fallidos)", () => {
    const r = watchdog.evaluateHealth(
      { status: "partial", hoursSinceLastSync: 1 },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/PARTIAL/);
  });

  it("status='failed' → exit 1 (pipeline fallió)", () => {
    const r = watchdog.evaluateHealth(
      { status: "failed", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(1);
    expect(r.reason).toMatch(/FAILED/);
  });

  it("status='unknown' (sin datos) → exit 0, no es error duro", () => {
    const r = watchdog.evaluateHealth(
      { status: "unknown", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/WARN/);
  });

  it("respuesta null o no-objeto → exit 1 (no se puede evaluar)", () => {
    expect(watchdog.evaluateHealth(null, 24).exitCode).toBe(1);
    expect(watchdog.evaluateHealth("string-not-object", 24).exitCode).toBe(1);
    expect(watchdog.evaluateHealth(42, 24).exitCode).toBe(1);
  });

  it("status desconocido (no es uno de los 5 documentados) → exit 0 con WARN", () => {
    const r = watchdog.evaluateHealth(
      { status: "weird-new-status", hoursSinceLastSync: null },
      24
    );
    expect(r.exitCode).toBe(0);
    expect(r.reason).toMatch(/WARN/);
  });
});

describe("health-watchdog — fetchHealth (con fetchFn inyectable)", () => {
  it("hace GET al endpoint correcto con los headers provistos", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ status: "ok" })
    });
    const result = await watchdog.fetchHealth(
      "https://example.com",
      { Accept: "application/json", Authorization: "Bearer xyz" },
      fetchFn,
      5000
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://example.com/api/admin/djiag-health");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: "Bearer xyz" });
    expect(result).toEqual({ status: "ok" });
  });

  it("lanza error tipado con .status si HTTP no es ok (401, 403, 5xx)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("No autenticado."),
      json: () => Promise.reject(new Error("not json"))
    });
    await expect(
      watchdog.fetchHealth("https://example.com", {}, fetchFn, 5000)
    ).rejects.toMatchObject({ status: 401, message: /HTTP 401/ });
  });

  it("aborta y lanza si la request tarda más que timeoutMs", async () => {
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    );
    await expect(
      watchdog.fetchHealth("https://example.com", {}, fetchFn, 100)
    ).rejects.toThrow();
  });
});

describe("health-watchdog — loadLocalEnv", () => {
  let tmpDir: string;
  let originalCwd: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-watchdog-env-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    savedEnv = {
      HEALTH_URL: process.env.HEALTH_URL,
      HEALTH_TOKEN: process.env.HEALTH_TOKEN,
      HEALTH_AUTH_COOKIE: process.env.HEALTH_AUTH_COOKIE,
      HEALTH_STALE_HOURS: process.env.HEALTH_STALE_HOURS
    };
    delete process.env.HEALTH_URL;
    delete process.env.HEALTH_TOKEN;
    delete process.env.HEALTH_AUTH_COOKIE;
    delete process.env.HEALTH_STALE_HOURS;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("carga HEALTH_URL y HEALTH_TOKEN desde .env.local", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "HEALTH_URL=https://aeroadmin.example.com\nHEALTH_TOKEN=abc123\n",
      "utf8"
    );
    watchdog.loadLocalEnv();
    expect(process.env.HEALTH_URL).toBe("https://aeroadmin.example.com");
    expect(process.env.HEALTH_TOKEN).toBe("abc123");
  });

  it("no pisa HEALTH_TOKEN ya seteada en process.env (CI > .env.local)", () => {
    process.env.HEALTH_TOKEN = "from-ci-secret";
    fs.writeFileSync(
      path.join(tmpDir, ".env.local"),
      "HEALTH_TOKEN=from-env-local\n",
      "utf8"
    );
    watchdog.loadLocalEnv();
    expect(process.env.HEALTH_TOKEN).toBe("from-ci-secret");
  });
});
