// Tests del endpoint GET /api/admin/djiag-health (XS1, audit 2026-07-22).
//
// Cobertura:
//   - 401 sin sesion (requireRole throws UNAUTHENTICATED)
//   - 403 supervisor (requireRole throws FORBIDDEN)
//   - 200 admin con archivo valido fresh (<24h) → status='ok', 0 warnings
//   - 200 admin con archivo valido stale (>24h) → status='stale', 1 warning
//   - 200 admin con archivo ausente → status='unknown', 1 warning
//   - 200 admin con archivo corrupto (JSON invalido) → status='unknown'
//   - 200 admin con health.partial → status='partial', 1 warning
//   - 200 admin con health.failed → status='failed', 1 warning
//   - deriveResponse es puro: null → status='unknown'
//   - 200 con HEALTH_TOKEN válido (bypass H3b) → no llama requireRole
//   - 401 con HEALTH_TOKEN inválido → cae al guard de role
//   - Sin HEALTH_TOKEN server-side, el bearer siempre falla (no bypass)
//   - **Sprint E — Task 2**: en serverless (VERCEL=1), el endpoint lee
//     de la tabla `djiag_health` en vez del filesystem. Si la DB falla,
//     devuelve status='unknown' sin crashear.
//
// Patrón consistente con tests/api-fumigation-schedule-auth.test.ts:
// mockear `@/lib/auth/role` con vi.hoisted. La lógica de read+derive
// está en `lib/djiag-health.ts` y se testea con tmpfiles en disco
// (sin mockear fs).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn()
}));

vi.mock("@/lib/auth/role", () => authMocks);
vi.mock("@/lib/db", () => dbMocks);

import { GET } from "@/app/api/admin/djiag-health/route";
import {
  deriveResponse,
  readHealthFile,
  type PipelineHealth
} from "@/lib/djiag-health";

function buildRequest(headers: Record<string, string> = {}, search = ""): NextRequest {
  const url = `http://localhost:3000/api/admin/djiag-health${search}`;
  return new NextRequest(url, { method: "GET", headers });
}

describe("GET /api/admin/djiag-health — guard de role", () => {
  let savedHealthToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Limpia HEALTH_TOKEN del ambiente para que estos tests no se vean
    // afectados por env vars del runner.
    savedHealthToken = process.env.HEALTH_TOKEN;
    delete process.env.HEALTH_TOKEN;
  });

  afterEach(() => {
    if (savedHealthToken === undefined) delete process.env.HEALTH_TOKEN;
    else process.env.HEALTH_TOKEN = savedHealthToken;
  });

  it("rechaza sin sesion (401 UNAUTHENTICATED)", async () => {
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await GET(buildRequest());
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("No autenticado.");
  });

  it("rechaza supervisor (403 FORBIDDEN)", async () => {
    const err = new Error("FORBIDDEN") as Error & { code?: string };
    err.code = "FORBIDDEN";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await GET(buildRequest());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/administradores/i);
  });

  it("admin pasa el guard (200) — body de unknown si no hay archivo", async () => {
    // Apuntamos process.cwd() a un dir temporal sin archivo de health.
    const tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-test-"));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      authMocks.requireRole.mockResolvedValueOnce(undefined);
      const response = await GET(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string; warnings: string[] };
      expect(body.status).toBe("unknown");
      expect(body.warnings.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// H3b (Sprint C — 2026-07-23): bypass para monitoring externo
// (GitHub Action watchdog). Si HEALTH_TOKEN está configurada en
// el server, el endpoint acepta Authorization: Bearer <token>
// o ?token=<token> en lugar de requireRole("admin").
// ============================================================
describe("GET /api/admin/djiag-health — bypass HEALTH_TOKEN (H3b)", () => {
  let savedHealthToken: string | undefined;
  const SERVER_TOKEN = "server-side-shared-secret-32chars";

  beforeEach(() => {
    vi.clearAllMocks();
    savedHealthToken = process.env.HEALTH_TOKEN;
  });

  afterEach(() => {
    if (savedHealthToken === undefined) delete process.env.HEALTH_TOKEN;
    else process.env.HEALTH_TOKEN = savedHealthToken;
  });

  function setupHealthFile() {
    const tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-bypass-"));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    // El endpoint busca el archivo en `djiag_exports/_health.json`
    // (path.join(process.cwd(), HEALTH_FILE_RELATIVE)). Lo creamos en
    // el subdirectorio correcto para que `readHealthFile` lo encuentre.
    const exportsDir = join(tmpDir, "djiag_exports");
    mkdirSync(exportsDir, { recursive: true });
    writeFileSync(
      join(exportsDir, "_health.json"),
      JSON.stringify({
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "ok",
        lastSuccessfulSyncAt: new Date().toISOString(),
        steps: [],
        totals: { flights: 5, fumigations: 2, lands: 1207 },
        version: 1
      }),
      "utf8"
    );
    return { tmpDir, originalCwd };
  }

  function teardownEnv({ tmpDir, originalCwd }: { tmpDir: string; originalCwd: string }) {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }

  it("con HEALTH_TOKEN server-side + Bearer válido → 200, NO llama requireRole", async () => {
    process.env.HEALTH_TOKEN = SERVER_TOKEN;
    const env = setupHealthFile();
    try {
      const response = await GET(buildRequest({ Authorization: `Bearer ${SERVER_TOKEN}` }));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");
      // CRÍTICO: el guard de role NO se llamó porque el bypass aplicó.
      expect(authMocks.requireRole).not.toHaveBeenCalled();
    } finally {
      teardownEnv(env);
    }
  });

  it("con HEALTH_TOKEN server-side + ?token= válido → 200 (alternativa para healthchecks)", async () => {
    process.env.HEALTH_TOKEN = SERVER_TOKEN;
    const env = setupHealthFile();
    try {
      const response = await GET(buildRequest({}, `?token=${SERVER_TOKEN}`));
      expect(response.status).toBe(200);
      expect(authMocks.requireRole).not.toHaveBeenCalled();
    } finally {
      teardownEnv(env);
    }
  });

  it("con HEALTH_TOKEN server-side + Bearer inválido → cae al guard (401/403)", async () => {
    process.env.HEALTH_TOKEN = SERVER_TOKEN;
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);
    const env = setupHealthFile();
    try {
      const response = await GET(buildRequest({ Authorization: "Bearer wrong-token" }));
      // El bearer inválido NO autoriza, así que cae al guard normal.
      // El guard lanza 401 porque no hay sesión.
      expect(response.status).toBe(401);
      expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
    } finally {
      teardownEnv(env);
    }
  });

  it("sin HEALTH_TOKEN server-side + Bearer cualquiera → 401 (no hay forma de bypass)", async () => {
    // process.env.HEALTH_TOKEN ya está borrado en el beforeEach.
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);
    const env = setupHealthFile();
    try {
      const response = await GET(buildRequest({ Authorization: "Bearer any-token" }));
      // Sin server-token, el bypass está deshabilitado. El bearer no
      // autoriza nada (no hay comparación que valide) → cae al guard.
      expect(response.status).toBe(401);
      expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
    } finally {
      teardownEnv(env);
    }
  });

  it("con HEALTH_TOKEN server-side pero sin Authorization → cae al guard (backwards compat)", async () => {
    process.env.HEALTH_TOKEN = SERVER_TOKEN;
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const env = setupHealthFile();
    try {
      // Sin Authorization ni ?token= → no aplica el bypass → usa el guard.
      const response = await GET(buildRequest());
      expect(response.status).toBe(200);
      expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
    } finally {
      teardownEnv(env);
    }
  });

  it("Authorization con scheme distinto a Bearer → NO aplica bypass", async () => {
    process.env.HEALTH_TOKEN = SERVER_TOKEN;
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    const env = setupHealthFile();
    try {
      const response = await GET(buildRequest({ Authorization: `Basic ${SERVER_TOKEN}` }));
      expect(response.status).toBe(200);
      // Basic auth no es válido para el bypass → cae al guard normal.
      expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
    } finally {
      teardownEnv(env);
    }
  });
});

describe("readHealthFile + deriveResponse — lógica pura", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeHealth(payload: object) {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, JSON.stringify(payload), "utf8");
    return p;
  }

  it("readHealthFile devuelve null si el archivo no existe", async () => {
    const result = await readHealthFile(join(tmpDir, "missing.json"));
    expect(result).toBeNull();
  });

  it("readHealthFile devuelve null si el JSON está corrupto", async () => {
    const p = join(tmpDir, "_health.json");
    writeFileSync(p, "{ not valid json", "utf8");
    const result = await readHealthFile(p);
    expect(result).toBeNull();
  });

  it("readHealthFile parsea un health válido", async () => {
    const p = writeHealth({
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: new Date().toISOString(),
      steps: [],
      totals: { flights: 5, fumigations: 2, lands: 1207 },
      version: 1
    });
    const result = await readHealthFile(p);
    expect(result).not.toBeNull();
    expect(result?.totals.flights).toBe(5);
  });

  it("deriveResponse: null → status='unknown' + 1 warning", () => {
    const r = deriveResponse(null);
    expect(r.status).toBe("unknown");
    expect(r.lastRunAt).toBeNull();
    expect(r.hoursSinceLastSync).toBeNull();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/no existe|corrupto/);
  });

  it("deriveResponse: ok + fresh → status='ok', 0 warnings", () => {
    const health: PipelineHealth = {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: new Date().toISOString(),
      steps: [],
      totals: { flights: 10, fumigations: 5, lands: 1207 },
      version: 1
    };
    const r = deriveResponse(health);
    expect(r.status).toBe("ok");
    expect(r.warnings).toHaveLength(0);
    expect(r.hoursSinceLastSync).not.toBeNull();
    expect(r.hoursSinceLastSync!).toBeLessThan(1);
  });

  it("deriveResponse: ok pero stale (>24h) → status='stale', 1 warning", () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString(); // 48h ago
    const health: PipelineHealth = {
      lastRunAt: old,
      lastRunStatus: "ok",
      lastSuccessfulSyncAt: old,
      steps: [],
      totals: { flights: 10, fumigations: 5, lands: 1207 },
      version: 1
    };
    const r = deriveResponse(health);
    expect(r.status).toBe("stale");
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
    expect(r.warnings.some((w) => w.includes("48"))).toBe(true);
    expect(r.hoursSinceLastSync).toBe(48);
  });

  it("deriveResponse: partial → status='partial', 1 warning", () => {
    const health: PipelineHealth = {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "partial",
      lastSuccessfulSyncAt: null,
      steps: [],
      totals: { flights: 10, fumigations: 5, lands: 0 },
      version: 1
    };
    const r = deriveResponse(health);
    expect(r.status).toBe("partial");
    expect(r.warnings.some((w) => /steps fallidos/i.test(w))).toBe(true);
  });

  it("deriveResponse: failed → status='failed', 1 warning", () => {
    const health: PipelineHealth = {
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "failed",
      lastSuccessfulSyncAt: null,
      steps: [],
      totals: { flights: 0, fumigations: 0, lands: 0 },
      version: 1
    };
    const r = deriveResponse(health);
    expect(r.status).toBe("failed");
    expect(r.warnings.some((w) => /falló/i.test(w))).toBe(true);
  });
});

// ============================================================
// Sprint E — Task 2: serverless (VERCEL=1) lee de Postgres.
// ============================================================
describe("GET /api/admin/djiag-health — serverless (VERCEL=1, lee de DB)", () => {
  let savedVercel: string | undefined;
  let savedLambda: string | undefined;
  let savedHealthToken: string | undefined;

  // Helper: el cliente de DB mockeado que el endpoint va a usar.
  function makeDbClient(rows: unknown[] | "throw") {
    if (rows === "throw") {
      return {
        query: vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
      };
    }
    return {
      query: vi.fn().mockResolvedValue({ rows })
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    savedVercel = process.env.VERCEL;
    savedLambda = process.env.AWS_LAMBDA_FUNCTION_NAME;
    savedHealthToken = process.env.HEALTH_TOKEN;
    // serverless mode
    process.env.VERCEL = "1";
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.HEALTH_TOKEN;
    // Por default, getDb() devuelve un cliente mockeado que devuelve
    // 0 rows (la tabla vacía → status='unknown'). Los tests
    // individuales lo sobrescriben.
    dbMocks.getDb.mockReturnValue(makeDbClient([]));
    // requireRole no debería ser llamado si somos admin via session
    // o via token, pero como NO seteamos HEALTH_TOKEN, sí va a
    // ser llamado. Lo dejamos como default success.
    authMocks.requireRole.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    if (savedLambda === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = savedLambda;
    if (savedHealthToken === undefined) delete process.env.HEALTH_TOKEN;
    else process.env.HEALTH_TOKEN = savedHealthToken;
  });

  it("lee de la DB (no del filesystem) cuando VERCEL=1", async () => {
    const now = new Date();
    dbMocks.getDb.mockReturnValue(
      makeDbClient([
        {
          last_run_at: now,
          last_run_status: "ok",
          last_successful_sync_at: now,
          flights_count: 10,
          fumigations_count: 5,
          lands_count: 1207,
          steps: []
        }
      ])
    );

    // Apuntamos process.cwd() a un dir SIN archivo de health — si el
    // endpoint leyera del filesystem, devolvería 'unknown'. Como
    // lee de la DB, debe devolver 'ok'.
    const tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-sls-"));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const response = await GET(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        status: string;
        flightsLastSync: number;
      };
      expect(body.status).toBe("ok");
      expect(body.flightsLastSync).toBe(10);
      // Confirmamos que llamó a la DB (no al fs).
      expect(dbMocks.getDb).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("devuelve status='unknown' si la DB no tiene la fila (0 rows)", async () => {
    dbMocks.getDb.mockReturnValue(makeDbClient([]));
    const response = await GET(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; warnings: string[] };
    expect(body.status).toBe("unknown");
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it("devuelve status='unknown' si la DB tira ECONNREFUSED (no 500)", async () => {
    dbMocks.getDb.mockReturnValue(makeDbClient("throw"));
    const response = await GET(buildRequest());
    // NO 500 — el caller (UI) puede mostrar "Sin datos" sin crashear.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("unknown");
  });

  it("lee de DB también cuando AWS_LAMBDA_FUNCTION_NAME está seteada (no solo VERCEL)", async () => {
    delete process.env.VERCEL;
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-lambda-fn";
    const now = new Date();
    dbMocks.getDb.mockReturnValue(
      makeDbClient([
        {
          last_run_at: now,
          last_run_status: "ok",
          last_successful_sync_at: now,
          flights_count: 1,
          fumigations_count: 1,
          lands_count: 1,
          steps: []
        }
      ])
    );
    const response = await GET(buildRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
    expect(dbMocks.getDb).toHaveBeenCalled();
  });

  it("en local (VERCEL undefined) sigue leyendo del filesystem (backwards compat)", async () => {
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    // En local, getDb NO debería ser llamado.
    dbMocks.getDb.mockClear();
    // Apuntamos a un tmpdir con archivo válido.
    const tmpDir = mkdtempSync(join(tmpdir(), "djiag-health-local-"));
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    const exportsDir = join(tmpDir, "djiag_exports");
    mkdirSync(exportsDir, { recursive: true });
    writeFileSync(
      join(exportsDir, "_health.json"),
      JSON.stringify({
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "ok",
        lastSuccessfulSyncAt: new Date().toISOString(),
        steps: [],
        totals: { flights: 1, fumigations: 1, lands: 1 },
        version: 1
      }),
      "utf8"
    );
    try {
      const response = await GET(buildRequest());
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");
      // La DB no se llamó en local.
      expect(dbMocks.getDb).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
