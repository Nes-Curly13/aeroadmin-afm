// Tests para `requireFreshRole` (MT-02, issue #27).
//
// Helper "doble check" para endpoints destructivos:
//   1) requireRole (JWT) — fast fail para no-admins.
//   2) getCurrentUserRole (BD) — truth fresh. Si difiere del JWT, lanza 403.
//      Si BD falla (null), cae al JWT + log warning.
//
// Estrategia de mocks (consistente con tests/lib/auth/role.test.ts):
//   - `next-auth` (lib/auth.ts re-exporta `auth`): vi.hoisted + vi.mock,
//     capturamos la sesion inyectada por test.
//   - `@/lib/db` (getDb): vi.hoisted + vi.mock, dbQueryMock controlable.
//   - IMPORT ESTATICO al top.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authSession: null as unknown,
  dbQuery: vi.fn() as ReturnType<typeof vi.fn>
}));

vi.mock("@/lib/auth", () => ({
  // `auth()` re-export de NextAuth. Lo mockeamos para que cada test
  // controle la sesion (null = sin sesion, {...} = logueado).
  auth: () => Promise.resolve(mocks.authSession)
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    query: (...args: unknown[]) => mocks.dbQuery(...args)
  })
}));

// IMPORT DESPUES de los mocks — patron tests/lib/auth/role.test.ts.
import { requireFreshRole } from "@/lib/auth/role";

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.authSession = null;
  mocks.dbQuery.mockReset();
  // Capturamos warnings para validar el fallback (caso BD caida).
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// requireFreshRole (MT-02, issue #27)
// ─────────────────────────────────────────────────────────────────────

describe("requireFreshRole", () => {
  it("1. JWT=admin + BD=admin → succeeds (sin warning)", async () => {
    mocks.authSession = {
      user: { email: "admin@op.local", id: "1", role: "admin" }
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });

    await expect(requireFreshRole("admin")).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("2. JWT=admin + BD=null (BD down) → succeeds + log warning", async () => {
    mocks.authSession = {
      user: { email: "admin@op.local", id: "1", role: "admin" }
    };
    // BD lanza error → getCurrentUserRole catch-ea y devuelve null.
    mocks.dbQuery.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(requireFreshRole("admin")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[requireFreshRole\]/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/fallback al JWT/);
  });

  it("3. JWT=admin + BD=supervisor (degradado) → throws FORBIDDEN", async () => {
    mocks.authSession = {
      user: { email: "user@op.local", id: "1", role: "admin" }
    };
    // El usuario era admin cuando se logueo, pero la BD dice supervisor.
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ role: "supervisor" }] });

    await expect(requireFreshRole("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: "rol degradado en BD"
    });
    // No hay warning: el BD respondio bien, solo que downgrade.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("4. sin sesion → throws UNAUTHENTICATED (no toca BD)", async () => {
    mocks.authSession = null;
    await expect(requireFreshRole("admin")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
    // requireRole corta antes de getCurrentUserRole → 0 BD hits.
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("5. JWT role insuficiente (supervisor pidiendo admin) → throws FORBIDDEN sin tocar BD", async () => {
    mocks.authSession = {
      user: { email: "s@op.local", id: "1", role: "supervisor" }
    };
    await expect(requireFreshRole("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
    // requireRole corta en el JWT → no se consulta BD.
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("6. JWT=supervisor + required=['admin','supervisor'] + BD=supervisor → succeeds", async () => {
    mocks.authSession = {
      user: { email: "s@op.local", id: "1", role: "supervisor" }
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ role: "supervisor" }] });

    await expect(
      requireFreshRole(["admin", "supervisor"])
    ).resolves.toBeUndefined();
  });

  it("7. JWT=admin + BD=admin pero con email sin trim/lowercase mismatch → BD null + warning", async () => {
    // Edge case: la sesion tiene email con mayuscula, getCurrentUserRole
    // lo normaliza a lowercase antes del SELECT. Si la BD tiene la fila
    // con el email normalizado, matchea. Si no la tiene, devuelve null
    // y caemos al JWT.
    mocks.authSession = {
      user: { email: "Admin@OP.LOCAL", id: "1", role: "admin" }
    };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] }); // email no existe

    await expect(requireFreshRole("admin")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
