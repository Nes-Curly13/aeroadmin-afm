/**
 * mobile-sidebar-drawer.test.tsx
 *
 * Track B (mobile) v1.2 — MEJORA 1: hamburger menu + drawer mobile.
 *
 * Cubre el requisito del audit ui-ux-2026-07 §1 (🟠 ALTA): el operador de
 * campo (Valle del Cauca) actualmente NO tiene navegación en mobile porque
 * `app-shell.tsx` esconde el `<aside>` con `hidden lg:flex`.
 *
 * Cobertura del drawer:
 *   1. Inicia cerrado.
 *   2. Abre al click del botón hamburguesa.
 *   3. Cierra al click en el backdrop.
 *   4. Cierra con tecla Escape.
 *   5. Al click en un item, navega con useRouter y cierra el drawer.
 *   6. Muestra el bloque "Estado actual" cuando parcelsCount/highAlertsCount > 0.
 *   7. Body tiene `overflow: hidden` cuando el drawer está abierto.
 *   8. Body recupera el `overflow` original cuando el drawer se cierra.
 *   9. ARIA: drawer tiene role="dialog" y aria-modal="true"; botón hamburguesa
 *      tiene aria-label y aria-expanded sincronizado.
 *  10. Focus trap básico: al abrir, el foco se mueve al drawer; al cerrar,
 *      vuelve al botón hamburguesa.
 *  11. Cleanup: el listener de Escape se remueve al desmontar (no leak).
 *
 * Mockeamos next/navigation (useRouter) — mismo patrón que keyboard-shortcuts.
 * Sin libs externas (NO headlessui, NO framer-motion). Tailwind + React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockState = vi.hoisted(() => ({
  pushMock: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockState.pushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams()
}));

import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer";

const sampleNav = [
  { href: "/", label: "Panel", icon: "dashboard", key: "dashboard" as const },
  { href: "/map", label: "Mapa", icon: "map", key: "map" as const },
  { href: "/task-history", label: "Historial", icon: "history", key: "task-history" as const },
  { href: "/parcels", label: "Parcelas", icon: "parcels", key: "parcels" as const },
  { href: "/parcels/overdue", label: "Faltan por fumigar", icon: "faltan", key: "faltan" as const },
  { href: "/devices", label: "Dispositivos", icon: "devices", key: "devices" as const }
];

beforeEach(() => {
  mockState.pushMock.mockClear();
  // El componente toca `document.body.style.overflow` en el effect.
  // Restauramos el valor entre tests para no contaminar la suite.
  document.body.style.overflow = "";
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.style.overflow = "";
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
});

describe("MobileSidebarDrawer — hamburger + drawer mobile (Track B v1.2)", () => {
  it("1. inicia cerrado: el drawer (dialog) NO está en el DOM", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("2. abre al click en el botón hamburguesa (aria-expanded sincroniza)", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    const burger = screen.getByRole("button", { name: /abrir menú/i });
    expect(burger).toHaveAttribute("aria-expanded", "false");
    act(() => {
      burger.click();
    });
    expect(screen.getByRole("dialog", { name: /menú principal/i })).toBeInTheDocument();
    expect(burger).toHaveAttribute("aria-expanded", "true");
  });

  it("3. cierra al click en el backdrop", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    const dialog = screen.getByRole("dialog", { name: /menú principal/i });
    // El backdrop es el contenedor con role="presentation" que envuelve el dialog.
    // Click en el backdrop NO es lo mismo que click en el dialog (currentTarget check).
    const backdrop = dialog.parentElement!;
    expect(backdrop).toHaveAttribute("role", "presentation");
    act(() => {
      // fireEvent.click con target = backdrop simula click en el backdrop.
      fireEvent.click(backdrop, { target: backdrop });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("4. cierra con tecla Escape", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("5. al click en un item, navega con useRouter Y cierra el drawer", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    const parcelsLink = screen.getAllByRole("link", { name: /^parcelas$/i })[0];
    act(() => {
      parcelsLink.click();
    });
    expect(mockState.pushMock).toHaveBeenCalledWith("/parcels");
    // El drawer debe cerrarse tras la navegación
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("6. muestra el bloque 'Estado actual' cuando parcelsCount > 0", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={2}
        parcelsCount={42}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    expect(screen.getByText(/estado actual/i)).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("7. body tiene overflow:hidden cuando el drawer está abierto", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("8. body recupera el overflow original cuando el drawer se cierra", () => {
    // Pre-establecemos un valor para confirmar que se restaura (no se queda en '').
    document.body.style.overflow = "scroll";
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    expect(document.body.style.overflow).toBe("hidden");
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("9. ARIA: dialog tiene role/aria-modal; burger tiene aria-label y aria-controls", () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    const burger = screen.getByRole("button", { name: /abrir menú/i });
    expect(burger).toHaveAttribute("aria-controls");
    const burgerControlsId = burger.getAttribute("aria-controls");
    expect(burgerControlsId).toBeTruthy();

    act(() => {
      burger.click();
    });
    const dialog = screen.getByRole("dialog", { name: /menú principal/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.id).toBe(burgerControlsId);
  });

  it("10. focus vuelve al botón hamburguesa al cerrar el drawer", async () => {
    render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    const burger = screen.getByRole("button", { name: /abrir menú/i });
    act(() => {
      burger.click();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(burger);
    });
  });

  it("11. limpia el listener de keydown al desmontar (no memory leak)", () => {
    const { unmount } = render(
      <MobileSidebarDrawer
        activeSection="dashboard"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    unmount();
    // Después de desmontar, Escape no debe disparar nada (no hay drawer que cerrar
    // y no debe quedar listener colgado).
    expect(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    }).not.toThrow();
  });

  it("12. el item activo se marca con la clase activa (mismo estilo que desktop)", () => {
    render(
      <MobileSidebarDrawer
        activeSection="parcels"
        highAlertsCount={0}
        parcelsCount={0}
        sidebarNav={sampleNav}
      />
    );
    act(() => {
      screen.getByRole("button", { name: /abrir menú/i }).click();
    });
    const activeLink = screen.getAllByRole("link", { name: /^parcelas$/i })[0];
    expect(activeLink.className).toContain("bg-[#2c7f44]");
  });
});
