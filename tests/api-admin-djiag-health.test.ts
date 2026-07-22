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
//
// Patrón consistente con tests/api-fumigation-schedule-auth.test.ts:
// mockear `@/lib/auth/role` con vi.hoisted. La lógica de read+derive
// está en `lib/djiag-health.ts` y se testea con tmpfiles en disco
// (sin mockear fs).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

vi.mock("@/lib/auth/role", () => authMocks);

import { GET } from "@/app/api/admin/djiag-health/route";
import {
  deriveResponse,
  readHealthFile,
  type PipelineHealth
} from "@/lib/djiag-health";

describe("GET /api/admin/djiag-health — guard de role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza sin sesion (401 UNAUTHENTICATED)", async () => {
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await GET();
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("No autenticado.");
  });

  it("rechaza supervisor (403 FORBIDDEN)", async () => {
    const err = new Error("FORBIDDEN") as Error & { code?: string };
    err.code = "FORBIDDEN";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await GET();
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
      const response = await GET();
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
