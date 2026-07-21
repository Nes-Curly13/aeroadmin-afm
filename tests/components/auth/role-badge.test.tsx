/**
 * role-badge.test.tsx
 *
 * Track B v1.4 — UI gates por role.
 *
 * Cubre el badge que muestra el role del usuario en el header. La
 * decision de diseno: solo visible si hay sesion (role != null). Si
 * no hay sesion (o carga), el badge NO se renderiza (no se ve
 * "cargando..." en el header).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useUserRoleMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/use-user-role", () => ({
  useUserRole: useUserRoleMock
}));

import { RoleBadge } from "@/components/auth/role-badge";

describe("RoleBadge", () => {
  beforeEach(() => {
    useUserRoleMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza el label 'Administrador' para role=admin", () => {
    useUserRoleMock.mockReturnValue("admin");

    render(<RoleBadge />);

    expect(screen.getByText(/administrador/i)).toBeInTheDocument();
  });

  it("renderiza el label 'Supervisor' para role=supervisor", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    render(<RoleBadge />);

    expect(screen.getByText(/supervisor/i)).toBeInTheDocument();
  });

  it("usa color verde olivo para admin (clase de bg con hex #0b5f2d)", () => {
    useUserRoleMock.mockReturnValue("admin");

    render(<RoleBadge />);

    const badge = screen.getByText(/administrador/i);
    // El badge envuelve el texto en un span con la clase de color.
    expect(badge.className).toContain("bg-[#0b5f2d]");
    expect(badge.className).toContain("text-white");
  });

  it("usa color gris para supervisor (clase de bg con hex #4a5b50)", () => {
    useUserRoleMock.mockReturnValue("supervisor");

    render(<RoleBadge />);

    const badge = screen.getByText(/supervisor/i);
    expect(badge.className).toContain("bg-[#4a5b50]");
    expect(badge.className).toContain("text-white");
  });

  it("NO renderiza nada cuando no hay sesion (role=null)", () => {
    useUserRoleMock.mockReturnValue(null);

    const { container } = render(<RoleBadge />);

    // El container existe pero esta vacio (no hay badge de "Cargando...").
    expect(container.textContent).toBe("");
  });

  it("tiene rol accesible 'status' para que screen readers lo anuncien", () => {
    useUserRoleMock.mockReturnValue("admin");

    render(<RoleBadge />);

    expect(screen.getByRole("status")).toHaveTextContent(/administrador/i);
  });
});
