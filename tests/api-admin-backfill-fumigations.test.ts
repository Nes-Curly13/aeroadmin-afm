// Tests del endpoint POST /api/admin/backfill-fumigations (Sprint H2).
//
// Cobertura:
//   - 401 sin sesion (requireRole throws UNAUTHENTICATED)
//   - 403 supervisor (requireRole throws FORBIDDEN)
//   - 200 admin OK: refreshFumigationsInTransaction corre y devuelve stats
//   - 500 si la transacción falla (error de BD)
//   - Bypass de Bearer BACKFILL_TOKEN: 200 sin sesión, no llama requireRole
//   - Bearer BACKFILL_TOKEN inválido: 401, cae al guard de role
//   - Sin BACKFILL_TOKEN server-side, el bearer siempre falla
//
// Patrón consistente con tests/api-admin-djiag-health.test.ts:
// mockear `@/lib/auth/role` + la función refresh con vi.hoisted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

const refreshMocks = vi.hoisted(() => ({
  refreshFumigationsInTransaction: vi.fn()
}));

vi.mock("@/lib/auth/role", () => authMocks);
vi.mock("@/lib/backfill/refresh-fumigations", () => refreshMocks);

import { POST } from "@/app/api/admin/backfill-fumigations/route";

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/backfill-fumigations", {
    method: "POST",
    headers
  });
}

describe("POST /api/admin/backfill-fumigations — guard de role", () => {
  let savedBackfillToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    savedBackfillToken = process.env.BACKFILL_TOKEN;
    // Default: borrar BACKFILL_TOKEN del ambiente para que estos
    // tests no se vean afectados por env vars del runner.
    delete process.env.BACKFILL_TOKEN;
  });

  afterEach(() => {
    if (savedBackfillToken === undefined) delete process.env.BACKFILL_TOKEN;
    else process.env.BACKFILL_TOKEN = savedBackfillToken;
  });

  it("rechaza sin sesion (401 UNAUTHENTICATED)", async () => {
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("UNAUTHENTICATED");
  });

  it("rechaza supervisor (403 FORBIDDEN)", async () => {
    const err = new Error("FORBIDDEN") as Error & { code?: string };
    err.code = "FORBIDDEN";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await POST(buildRequest());
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("FORBIDDEN");
  });

  it("admin pasa el guard (200) — corre el backfill y devuelve stats", async () => {
    const fakeStats = {
      backfilled: 50,
      deleted: 0,
      scheduleUpdated: 12,
      durationMs: 142
    };
    refreshMocks.refreshFumigationsInTransaction.mockResolvedValueOnce(fakeStats);
    authMocks.requireRole.mockResolvedValueOnce(undefined);

    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(fakeStats);
    expect(refreshMocks.refreshFumigationsInTransaction).toHaveBeenCalledTimes(1);
  });

  it("devuelve 500 con BACKFILL_FAILED si la tx falla", async () => {
    refreshMocks.refreshFumigationsInTransaction.mockRejectedValueOnce(
      new Error("connection refused")
    );
    authMocks.requireRole.mockResolvedValueOnce(undefined);

    const response = await POST(buildRequest());
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string; message?: string };
    expect(body.error).toBe("BACKFILL_FAILED");
    expect(body.message).toBe("connection refused");
  });
});

describe("POST /api/admin/backfill-fumigations — bypass BACKFILL_TOKEN", () => {
  let savedBackfillToken: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    savedBackfillToken = process.env.BACKFILL_TOKEN;
  });

  afterEach(() => {
    if (savedBackfillToken === undefined) delete process.env.BACKFILL_TOKEN;
    else process.env.BACKFILL_TOKEN = savedBackfillToken;
  });

  it("200 con BACKFILL_TOKEN válido — no llama requireRole", async () => {
    process.env.BACKFILL_TOKEN = "secret-bearer-token-abc123";
    const fakeStats = {
      backfilled: 100,
      deleted: 50,
      scheduleUpdated: 30,
      durationMs: 250
    };
    refreshMocks.refreshFumigationsInTransaction.mockResolvedValueOnce(fakeStats);

    const response = await POST(
      buildRequest({ authorization: "Bearer secret-bearer-token-abc123" })
    );
    expect(response.status).toBe(200);
    expect(authMocks.requireRole).not.toHaveBeenCalled();
    expect(refreshMocks.refreshFumigationsInTransaction).toHaveBeenCalledTimes(1);
  });

  it("401 con BACKFILL_TOKEN inválido — cae al guard de role (sin sesión)", async () => {
    process.env.BACKFILL_TOKEN = "secret-bearer-token-abc123";
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await POST(
      buildRequest({ authorization: "Bearer TOKEN-INCORRECTO" })
    );
    expect(response.status).toBe(401);
    expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
  });

  it("acepta comparación case-insensitive del prefijo 'Bearer'", async () => {
    // "bearer" en minúsculas también debe funcionar (timing-safe compare
    // sobre el resto del header).
    process.env.BACKFILL_TOKEN = "secret-bearer-token-abc123";
    const fakeStats = {
      backfilled: 0,
      deleted: 0,
      scheduleUpdated: 0,
      durationMs: 0
    };
    refreshMocks.refreshFumigationsInTransaction.mockResolvedValueOnce(fakeStats);

    const response = await POST(
      buildRequest({ authorization: "bearer secret-bearer-token-abc123" })
    );
    expect(response.status).toBe(200);
    expect(authMocks.requireRole).not.toHaveBeenCalled();
  });

  it("401 si Authorization NO empieza con 'Bearer '", async () => {
    process.env.BACKFILL_TOKEN = "secret-bearer-token-abc123";
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    // 'Basic' en vez de 'Bearer' → bypass NO aplica → cae al guard
    const response = await POST(
      buildRequest({ authorization: "Basic dXNlcjpwYXNz" })
    );
    expect(response.status).toBe(401);
    expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
  });

  it("sin BACKFILL_TOKEN server-side, el bypass está deshabilitado y siempre requiere sesión", async () => {
    // savedBackfillToken is undefined → no seteamos process.env
    delete process.env.BACKFILL_TOKEN;
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await POST(
      buildRequest({ authorization: "Bearer cualquier-cosa" })
    );
    expect(response.status).toBe(401);
    expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
  });

  it("sin Authorization header, cae al guard de sesión normal", async () => {
    process.env.BACKFILL_TOKEN = "secret-bearer-token-abc123";
    const err = new Error("FORBIDDEN") as Error & { code?: string };
    err.code = "FORBIDDEN";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await POST(buildRequest({}));
    expect(response.status).toBe(403);
    expect(authMocks.requireRole).toHaveBeenCalledTimes(1);
  });
});
