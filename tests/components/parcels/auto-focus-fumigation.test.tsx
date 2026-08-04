/**
 * tests/components/parcels/auto-focus-fumigation.test.tsx
 *
 * Tests del componente AutoFocusFumigation que se monta en /parcelas/[id]
 * cuando el URL tiene ?action=fumigar (sprint 2026-08-04, sub-sprint 3).
 *
 * Cubre:
 *   - Renderiza sin error cuando NO hay ?action=fumigar
 *   - Renderiza el banner "Parcela creada" cuando SÍ hay el query param
 *   - El botón "Cerrar" del banner oculta el banner
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock window.history y URL
const replaceStateMock = vi.fn();
const originalLocation = window.location;
beforeEach(() => {
  replaceStateMock.mockClear();
  Object.defineProperty(window, "location", {
    value: {
      ...originalLocation,
      href: "http://localhost:3000/parcelas/1?action=fumigar",
      search: "?action=fumigar",
      origin: "http://localhost:3000",
      pathname: "/parcelas/1"
    },
    writable: true,
    configurable: true
  });
  window.history.replaceState = replaceStateMock;
  // Mock scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

import { AutoFocusFumigation } from "@/components/parcels/auto-focus-fumigation";

describe("AutoFocusFumigation", () => {
  it("no muestra banner cuando NO hay ?action=fumigar en el URL", () => {
    // Re-mock: cambiar el search a vacío
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search: "", href: "http://localhost:3000/parcelas/1" },
      writable: true,
      configurable: true
    });
    const { container } = render(<AutoFocusFumigation />);
    expect(container.textContent).toBe("");
  });

  it("muestra banner 'Parcela creada' cuando hay ?action=fumigar", async () => {
    render(<AutoFocusFumigation />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    expect(screen.getByText(/Parcela creada/i)).toBeInTheDocument();
  });

  it("botón 'Cerrar' del banner oculta el banner", async () => {
    const user = userEvent.setup();
    render(<AutoFocusFumigation />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
    const closeBtn = screen.getByRole("button", { name: /Cerrar aviso/i });
    await user.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("limpia el query param ?action= del URL después de activarse", async () => {
    render(<AutoFocusFumigation />);
    await waitFor(() => {
      expect(replaceStateMock).toHaveBeenCalled();
    });
    // El nuevo URL no debe tener ?action=
    const calledWith = replaceStateMock.mock.calls[0][2] as string;
    expect(calledWith).not.toContain("action=fumigar");
  });
});
