// Tests del guard de role en PATCH /api/fumigation-schedule (v1.5).
//
// Cobertura:
//   - 401 cuando no hay sesión (requireRole throws UNAUTHENTICATED)
//   - 403 cuando el role NO es admin (requireRole throws FORBIDDEN)
//   - El body NO se valida ni la BD se toca cuando el guard falla
//     (la cadencia es admin-only, supervisors no pueden reprogramarla)
//
// Patrón consistente con tests/api-fumigations-length.test.ts y
// tests/lib/auth/role.test.ts: mockear `@/lib/auth/role` para
// controlar la respuesta de `requireRole` por test.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  requireRole: vi.fn()
}));

const repositoryMocks = vi.hoisted(() => ({
  setFumigationCadence: vi.fn()
}));

vi.mock("@/lib/auth/role", () => authMocks);
vi.mock("@/api/repositories", () => repositoryMocks);

import { PATCH as patchScheduleRoute } from "@/app/api/fumigation-schedule/[parcelId]/route";

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost:3000/api/fumigation-schedule/1",
    {
      method: "PATCH",
      body: JSON.stringify(body)
    }
  );
}

const PARAMS = { params: Promise.resolve({ parcelId: "1" }) };
const VALID_BODY = { recommended_cadence_days: 21 };

describe("PATCH /api/fumigation-schedule — guard de role (v1.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza sin sesión (401 UNAUTHENTICATED)", async () => {
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await patchScheduleRoute(buildRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("No autenticado.");
    // El guard falla ANTES de validar el body o tocar la BD.
    expect(repositoryMocks.setFumigationCadence).not.toHaveBeenCalled();
  });

  it("rechaza supervisor (403 FORBIDDEN)", async () => {
    const err = new Error("FORBIDDEN") as Error & { code?: string };
    err.code = "FORBIDDEN";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await patchScheduleRoute(buildRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toMatch(/administradores/i);
    expect(repositoryMocks.setFumigationCadence).not.toHaveBeenCalled();
  });

  it("admin pasa el guard y ejecuta setFumigationCadence (200)", async () => {
    authMocks.requireRole.mockResolvedValueOnce(undefined);
    repositoryMocks.setFumigationCadence.mockResolvedValueOnce(undefined);

    const response = await patchScheduleRoute(buildRequest(VALID_BODY), PARAMS);
    expect(response.status).toBe(200);
    expect(repositoryMocks.setFumigationCadence).toHaveBeenCalledWith(1, 21);
  });

  it("guard corre ANTES de validar el body (401 incluso con body inválido)", async () => {
    // Defensa en profundidad: si el guard falla, no tiene sentido
    // devolver 400 por body inválido — devolvemos 401/403 primero.
    const err = new Error("UNAUTHENTICATED") as Error & { code?: string };
    err.code = "UNAUTHENTICATED";
    authMocks.requireRole.mockRejectedValueOnce(err);

    const response = await patchScheduleRoute(buildRequest({}), PARAMS);
    expect(response.status).toBe(401);
  });
});
