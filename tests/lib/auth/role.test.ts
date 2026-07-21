// Tests para `lib/auth/role.ts` (v1.4 Track A — RBAC).
//
// Cobertura:
//   - getCurrentUserRole: sin sesion, sesion admin, sesion supervisor,
//     sesion sin email, email sin fila en app_users, error de DB.
//   - requireRole: rechaza (throw 403), acepta single, acepta array,
//     acepta default 'supervisor' (legado), sesion null -> 401.
//   - hasRole (helper puro).
//
// Estrategia de mocks:
//   - `next-auth` (lib/auth.ts re-exporta `auth`): vi.hoisted + vi.mock,
//     capturamos la sesion inyectada por test.
//   - `@/lib/db` (getDb): vi.hoisted + vi.mock, dbQueryMock controlable
//     por test.
//   - IMPORT ESTATICO al top — Vitest levanta los mocks antes del import,
//     patron consistente con tests/auth.test.ts.

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

// IMPORT DESPUES de los mocks — patron tests/auth.test.ts.
import {
  getCurrentUserRole,
  getViewerRole,
  hasRole,
  requireRole
} from "@/lib/auth/role";

beforeEach(() => {
  mocks.authSession = null;
  mocks.dbQuery.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
// getCurrentUserRole
// ─────────────────────────────────────────────────────────────────────

describe("getCurrentUserRole", () => {
  it("devuelve null si no hay sesion", async () => {
    mocks.authSession = null;
    const role = await getCurrentUserRole();
    expect(role).toBeNull();
  });

  it("devuelve 'admin' cuando app_users tiene role admin para ese email", async () => {
    mocks.authSession = { user: { email: "admin@op.local" } };
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ role: "admin" }]
    });
    const role = await getCurrentUserRole();
    expect(role).toBe("admin");
  });

  it("devuelve 'supervisor' cuando app_users tiene role supervisor para ese email", async () => {
    mocks.authSession = { user: { email: "super@op.local" } };
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [{ role: "supervisor" }]
    });
    const role = await getCurrentUserRole();
    expect(role).toBe("supervisor");
  });

  it("devuelve null si la sesion no tiene email", async () => {
    mocks.authSession = { user: {} };
    const role = await getCurrentUserRole();
    expect(role).toBeNull();
  });

  it("devuelve null si la query no devuelve filas (email no existe en app_users)", async () => {
    mocks.authSession = { user: { email: "ghost@op.local" } };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    const role = await getCurrentUserRole();
    expect(role).toBeNull();
  });

  it("normaliza email a lowercase antes de consultar la BD", async () => {
    mocks.authSession = { user: { email: "Admin@OP.LOCAL  " } };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    await getCurrentUserRole();
    const [, params] = mocks.dbQuery.mock.calls[0];
    expect(params[0]).toBe("admin@op.local"); // trim + lowercase
  });

  it("devuelve null si la BD lanza error (no propaga)", async () => {
    mocks.authSession = { user: { email: "x@y.com" } };
    mocks.dbQuery.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const role = await getCurrentUserRole();
    expect(role).toBeNull();
  });

  it("consulta por email (no por uid) y usa LIMIT 1", async () => {
    mocks.authSession = { user: { email: "a@b.com" } };
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    await getCurrentUserRole();
    const [sql, params] = mocks.dbQuery.mock.calls[0];
    expect(sql).toMatch(/FROM\s+app_users/);
    expect(sql).toMatch(/email\s*=\s*\$1/i);
    expect(sql).toMatch(/LIMIT\s+1/i);
    expect(params).toEqual(["a@b.com"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// requireRole
// ─────────────────────────────────────────────────────────────────────

describe("requireRole", () => {
  it("lanza 401 si no hay sesion (delega en requireAuth)", async () => {
    mocks.authSession = null;
    await expect(requireRole("admin")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
  });

  it("lanza 403 si el role no matchea (string unico)", async () => {
    mocks.authSession = {
      user: { email: "x@y.com", id: "1", role: "supervisor" }
    };
    // requireRole lee rol de la sesion (no de la BD), asi que la
    // BD no se consulta en este path.
    await expect(requireRole("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("acepta cuando el role matchea exactamente (string unico)", async () => {
    mocks.authSession = {
      user: { email: "x@y.com", id: "1", role: "admin" }
    };
    await expect(requireRole("admin")).resolves.toBeUndefined();
  });

  it("acepta cuando el role esta en el array provisto", async () => {
    mocks.authSession = {
      user: { email: "x@y.com", id: "1", role: "supervisor" }
    };
    await expect(requireRole(["admin", "supervisor"])).resolves.toBeUndefined();
  });

  it("rechaza si el role NO esta en el array provisto", async () => {
    mocks.authSession = {
      user: { email: "x@y.com", id: "1", role: "viewer" } // legado
    };
    await expect(requireRole(["admin", "supervisor"])).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("lanza 403 si la sesion no tiene role definido", async () => {
    mocks.authSession = { user: { email: "x@y.com" } };
    await expect(requireRole("admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// hasRole (helper puro)
// ─────────────────────────────────────────────────────────────────────

describe("hasRole", () => {
  it("true si el role actual esta en la lista", () => {
    expect(hasRole("admin", ["admin", "supervisor"])).toBe(true);
  });

  it("true si el role actual matchea el string unico", () => {
    expect(hasRole("supervisor", "supervisor")).toBe(true);
  });

  it("false si el role actual no esta en la lista", () => {
    expect(hasRole("supervisor", "admin")).toBe(false);
    expect(hasRole("admin", ["supervisor"])).toBe(false);
  });

  it("false si el role actual es null/undefined", () => {
    expect(hasRole(null, "admin")).toBe(false);
    expect(hasRole(undefined, ["admin", "supervisor"])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getViewerRole (v1.5 — sidebar gate)
//
// Lee el role del JWT (sin DB hit). Pensado para UI condicional.
// Diferencia con getCurrentUserRole: este es rapido y puede tener
// hasta ~12h de stale-ness; getCurrentUserRole lee de la BD (truth fresh).
// ─────────────────────────────────────────────────────────────────────

describe("getViewerRole", () => {
  it("devuelve null cuando no hay sesion", async () => {
    mocks.authSession = null;
    const role = await getViewerRole();
    expect(role).toBeNull();
  });

  it("devuelve 'admin' cuando la sesion tiene role=admin", async () => {
    mocks.authSession = {
      user: { email: "a@y.com", id: "1", role: "admin" }
    };
    expect(await getViewerRole()).toBe("admin");
  });

  it("devuelve 'supervisor' cuando la sesion tiene role=supervisor", async () => {
    mocks.authSession = {
      user: { email: "s@y.com", id: "2", role: "supervisor" }
    };
    expect(await getViewerRole()).toBe("supervisor");
  });

  it("mapea role=viewer (legacy) a 'supervisor' (retrocompat)", async () => {
    mocks.authSession = {
      user: { email: "v@y.com", id: "3", role: "viewer" }
    };
    expect(await getViewerRole()).toBe("supervisor");
  });

  it("mapea role desconocido a 'supervisor' (least privilege)", async () => {
    mocks.authSession = {
      user: { email: "x@y.com", id: "4", role: "guest" }
    };
    expect(await getViewerRole()).toBe("supervisor");
  });

  it("NO toca la BD (diferencia con getCurrentUserRole)", async () => {
    // Si tocara la BD, dbQueryMock seria llamado. La idea es que
    // getViewerRole es JWT-only y la UI no paga el costo de un SELECT.
    mocks.authSession = {
      user: { email: "a@y.com", id: "1", role: "admin" }
    };
    await getViewerRole();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
