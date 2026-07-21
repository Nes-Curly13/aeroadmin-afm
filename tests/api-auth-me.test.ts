/**
 * api-auth-me.test.ts
 *
 * Track B v1.4 — UI gates por role.
 *
 * Cubre el route handler `app/api/auth/me/route.ts`. Mockeamos
 * `@/lib/auth` (que exporta `auth()`) con vi.hoisted. NO tocamos
 * `next-auth` ni el JWT — el endpoint solo lee la sesion que NextAuth
 * ya valido.
 *
 * Casos cubiertos:
 *   1. Sin sesion (auth() === null) -> 401
 *   2. Sesion con role=admin -> 200 + {email, role: "admin", name}
 *   3. Sesion con role=viewer -> 200 + {email, role: "supervisor", name}
 *      (mapeo retrocompatible: la BD actual tiene 'viewer' pero el
 *       dominio v1.4 lo renombra a 'supervisor')
 *   4. Sesion con role desconocido -> 200 + role por default
 *      (defensa en profundidad: no romper la UI)
 *   5. auth() tira excepcion -> 500 (no se propaga al cliente)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  auth: vi.fn()
}));

vi.mock("@/lib/auth", () => authMocks);

import { GET } from "@/app/api/auth/me/route";

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve 401 cuando no hay sesion (auth() === null)", async () => {
    authMocks.auth.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "No autenticado." });
  });

  it("devuelve 200 con role=admin cuando la sesion tiene role=admin", async () => {
    authMocks.auth.mockResolvedValueOnce({
      user: {
        id: "1",
        email: "admin@aeroadmin.local",
        role: "admin",
        name: "Admin User"
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: "admin@aeroadmin.local",
      role: "admin",
      name: "Admin User"
    });
  });

  it("mapea role=viewer (sesion legacy) a role=supervisor en la respuesta", async () => {
    // La sesion actual expone "viewer" (lib/auth.config.ts pre-Track A).
    // El endpoint lo traduce a "supervisor" para que el cliente vea
    // el dominio nuevo sin esperar a la migracion de Track A.
    authMocks.auth.mockResolvedValueOnce({
      user: {
        id: "2",
        email: "sup@aeroadmin.local",
        role: "viewer",
        name: "Sup User"
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: "sup@aeroadmin.local",
      role: "supervisor",
      name: "Sup User"
    });
  });

  it("acepta role=supervisor sin remapear (cuando Track A ya migro)", async () => {
    // Cuando Track A mergee, la sesion tendra role="supervisor" directo.
    // El endpoint NO debe re-mapear a admin ni a otra cosa.
    authMocks.auth.mockResolvedValueOnce({
      user: {
        id: "3",
        email: "s2@aeroadmin.local",
        role: "supervisor",
        name: "S2"
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "supervisor"
    });
  });

  it("devuelve role='supervisor' por default cuando el role de la sesion es desconocido", async () => {
    // Defensa en profundidad: si la BD tiene un role raro (ej. un
    // test que creo 'guest' por error), el endpoint no debe tirar 500.
    // Devuelve 'supervisor' (least privilege) para que la UI oculte
    // contenido admin-only por default.
    authMocks.auth.mockResolvedValueOnce({
      user: {
        id: "4",
        email: "x@y",
        role: "guest",
        name: null
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "supervisor"
    });
  });

  it("devuelve name=null cuando la sesion no tiene name (sesion JWT sin perfil)", async () => {
    authMocks.auth.mockResolvedValueOnce({
      user: {
        id: "5",
        email: "noName@y",
        role: "admin"
      }
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: "noName@y",
      role: "admin",
      name: null
    });
  });

  it("devuelve 500 si auth() rechaza (no propaga stack al cliente)", async () => {
    authMocks.auth.mockRejectedValueOnce(new Error("JWT verification failed"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "JWT verification failed"
    });
  });
});
