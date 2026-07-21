/**
 * use-user-role.test.ts
 *
 * Track B v1.4 — UI gates por role.
 *
 * Cubre el hook client `useUserRole()` que consume `/api/auth/me`.
 * Mockeamos `fetch` global (no importamos la implementación real) y
 * renderizamos un componente de prueba que expone el valor devuelto
 * por el hook.
 *
 * Por qué no usamos `renderHook` directo: en este repo RTL
 * (`@testing-library/react` v16) se usa con un componente wrapper
 * pequeño para poder inspeccionar el valor re-renderizado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import { useUserRole } from "@/components/auth/use-user-role";

function HookProbe(): ReactElement {
  const role = useUserRole();
  return (
    <div>
      <span data-testid="role">{role ?? "null"}</span>
    </div>
  );
}

describe("useUserRole", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("devuelve null mientras la peticion esta pendiente (antes del primer await)", async () => {
    // fetch que nunca resuelve durante el test
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<HookProbe />);
    // Primer render: el effect no termino, role debe ser null
    expect(screen.getByTestId("role").textContent).toBe("null");
  });

  it("devuelve 'admin' cuando /api/auth/me responde 200 con role=admin", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: "admin@aeroadmin", role: "admin", name: "Admin" })
    } as Response);

    render(<HookProbe />);

    // esperar a que el effect corra
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("admin");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No validamos el segundo argumento (options) porque la implementacion
    // actual no manda headers/method. Si en el futuro se agrega un override
    // (ej. `cache: "no-store"`), este test sigue verde y el cambio es local.
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/me");
  });

  it("devuelve 'supervisor' cuando /api/auth/me responde 200 con role=supervisor", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: "sup@aeroadmin", role: "supervisor", name: "Sup" })
    } as Response);

    render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("supervisor");
  });

  it("devuelve null cuando /api/auth/me responde 401 (sin sesion)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "No autenticado." })
    } as Response);

    render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("null");
  });

  it("devuelve null cuando el fetch rechaza (red caida / excepcion)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("null");
  });

  it("ignora roles desconocidos y devuelve null (defensa en profundidad)", async () => {
    // Si /api/auth/me devuelve algo inesperado, el hook no debe hacer
    // un cast laxo: lo trata como no-autenticado. Protege contra
    // un endpoint mal configurado que tire la UI abajo.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: "x@y", role: "superadmin", name: "X" })
    } as Response);

    render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("null");
  });

  it("hace exactamente 1 fetch por mount (no se re-fetchea en cada render)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: "a@a", role: "admin", name: "A" })
    } as Response);

    const { rerender } = render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-render no debe disparar otro fetch
    rerender(<HookProbe />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignora respuestas con body vacio o role faltante", async () => {
    // Edge case: el endpoint respondio 200 OK pero el body no tiene `role`.
    // El hook NO debe tirar ni crashear — trata como no autenticado.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ email: "x@y", name: "X" })
    } as Response);

    render(<HookProbe />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("role").textContent).toBe("null");
  });
});
