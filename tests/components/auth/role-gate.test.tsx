/**
 * role-gate.test.tsx
 *
 * Track B v1.4 — UI gates por role.
 *
 * Cubre el componente `RoleGate` que envuelve children y los renderiza
 * solo si el role del usuario está en la lista `allow`. Mockeamos
 * `useUserRole` con `vi.hoisted` para no depender del fetch real.
 *
 * Estrategia de mocking: el mock retorna el role que el test quiere
 * probar (admin, supervisor, null). El componente no debe distinguir
 * "aun cargando" de "no autenticado" — ambos son `null` y la UI
 * queda oculta. Esto evita un flash de contenido protegido antes
 * de que el fetch resuelva.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useUserRoleMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/use-user-role", () => ({
  useUserRole: useUserRoleMock
}));

import { RoleGate } from "@/components/auth/role-gate";

describe("RoleGate", () => {
  beforeEach(() => {
    useUserRoleMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza children cuando el role esta en la lista allow (admin)", () => {
    useUserRoleMock.mockReturnValue("admin");

    render(
      <RoleGate allow={["admin"]}>
        <button>Solo admin</button>
      </RoleGate>
    );

    expect(screen.getByRole("button", { name: /solo admin/i })).toBeInTheDocument();
  });

  it("renderiza children cuando allow tiene multiples roles y el user es supervisor", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    render(
      <RoleGate allow={["admin", "supervisor"]}>
        <span>Todos pueden ver esto</span>
      </RoleGate>
    );

    expect(screen.getByText(/todos pueden ver esto/i)).toBeInTheDocument();
  });

  it("NO renderiza children cuando el role NO esta en allow (supervisor bloqueado por admin-only)", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    render(
      <RoleGate allow={["admin"]}>
        <button>Solo admin</button>
      </RoleGate>
    );

    expect(screen.queryByRole("button", { name: /solo admin/i })).not.toBeInTheDocument();
  });

  it("NO renderiza children cuando el role es null (aun cargando o sin sesion)", () => {
    useUserRoleMock.mockReturnValue(null);

    render(
      <RoleGate allow={["admin", "supervisor"]}>
        <span>Contenido protegido</span>
      </RoleGate>
    );

    // El gate debe ser conservador: si no sabemos el role, NO mostramos
    // contenido que podria estar restringido. Esto evita el flash
    // de contenido antes de que el fetch resuelva.
    expect(screen.queryByText(/contenido protegido/i)).not.toBeInTheDocument();
  });

  it("renderiza el fallback cuando el role no esta permitido", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    render(
      <RoleGate
        allow={["admin"]}
        fallback={<p data-testid="fallback">No tenes permiso</p>}
      >
        <button>Solo admin</button>
      </RoleGate>
    );

    expect(screen.queryByRole("button", { name: /solo admin/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("fallback")).toHaveTextContent(/no tenes permiso/i);
  });

  it("renderiza null (sin fallback) cuando el role no esta permitido y no se pasa fallback", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    const { container } = render(
      <RoleGate allow={["admin"]}>
        <button>Solo admin</button>
      </RoleGate>
    );

    // El container existe pero no tiene contenido visible del gate.
    expect(screen.queryByRole("button", { name: /solo admin/i })).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("ignora el fallback cuando el role SI esta permitido (no se muestra dos veces)", () => {
    useUserRoleMock.mockReturnValue("admin");

    render(
      <RoleGate
        allow={["admin"]}
        fallback={<p data-testid="fallback">No tenes permiso</p>}
      >
        <button>Solo admin</button>
      </RoleGate>
    );

    expect(screen.getByRole("button", { name: /solo admin/i })).toBeInTheDocument();
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });
});
