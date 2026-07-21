import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// Track B v1.2: app-shell ahora renderiza <MobileSidebarDrawer> (client
// component) que usa useRouter. Mockeamos next/navigation para que el
// server component renderice sin reventar en jsdom ("invariant expected
// app router to be mounted").
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

import { AppShell } from "@/components/app-shell";

beforeEach(() => {
  mockState.pushMock.mockClear();
});

describe("AppShell", () => {
  it("renderiza las 6 secciones del nav con sus hrefs", () => {
    render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    expect(screen.getByRole("link", { name: /panel/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /mapa/i })).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: /historial/i })).toHaveAttribute("href", "/task-history");
    expect(screen.getByRole("link", { name: /^parcelas$/i })).toHaveAttribute("href", "/parcels");
    expect(screen.getByRole("link", { name: /faltan por fumigar/i })).toHaveAttribute("href", "/parcels/overdue");
    expect(screen.getByRole("link", { name: /dispositivos/i })).toHaveAttribute("href", "/devices");
  });

  it("acepta activeSection='parcels' y marca ese link como activo", () => {
    render(<AppShell activeSection="parcels" eyebrow="x" title="t" />);
    const parcelsLink = screen.getByRole("link", { name: /^parcelas$/i });
    expect(parcelsLink.className).toContain("bg-[#2c7f44]");
  });

  it("acepta activeSection='faltan' y marca ese link como activo", () => {
    render(<AppShell activeSection="faltan" eyebrow="x" title="t" />);
    const faltanLink = screen.getByRole("link", { name: /faltan por fumigar/i });
    expect(faltanLink.className).toContain("bg-[#2c7f44]");
  });

  it("marca como activo el link correspondiente a activeSection", () => {
    render(<AppShell activeSection="map" eyebrow="x" title="t" />);
    const mapLink = screen.getByRole("link", { name: /mapa/i });
    expect(mapLink.className).toContain("bg-[#2c7f44]");
  });

  it("renderiza el logo y el nombre de marca", () => {
    render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    expect(screen.getByAltText(/aeroadmin afm logo/i)).toBeInTheDocument();
    expect(screen.getAllByText(/aeroadmin afm/i).length).toBeGreaterThan(0);
  });

  it("no renderiza el bloque de Control de Vuelo (Despegue, Waypoints, etc.)", () => {
    render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    expect(screen.queryByText(/despegue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/waypoints/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/emergencia/i)).not.toBeInTheDocument();
  });

  it("no renderiza el botón Override Manual", () => {
    render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    expect(screen.queryByText(/override manual/i)).not.toBeInTheDocument();
  });

  it("no renderiza los iconos de notifications y settings (placeholders muertos)", () => {
    const { container } = render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    expect(container.querySelector('[aria-label="Notifications"]')).toBeNull();
    expect(container.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  it("pasa el actions slot al header y al main mobile", () => {
    render(
      <AppShell
        actions={<div data-testid="my-action">Hola</div>}
        activeSection="dashboard"
        eyebrow="x"
        title="t"
      />
    );
    // El action aparece 2 veces: una en el header (visible en sm+) y otra
    // en el main area (visible en <sm). Verificamos que al menos existe.
    const actions = screen.getAllByTestId("my-action");
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it("renderiza eyebrow, title y subtitle", () => {
    render(
      <AppShell
        activeSection="dashboard"
        eyebrow="Panel de Control"
        subtitle="Subtítulo custom"
        title="Mi Título"
      />
    );
    expect(screen.getByText("Panel de Control")).toBeInTheDocument();
    expect(screen.getByText("Mi Título")).toBeInTheDocument();
    expect(screen.getByText("Subtítulo custom")).toBeInTheDocument();
  });

  it("usa un subtitle por defecto si no se pasa", () => {
    render(<AppShell activeSection="dashboard" eyebrow="x" title="t" />);
    // el default menciona DJI
    expect(screen.getByText(/dji/i)).toBeInTheDocument();
  });

  describe("Estado actual", () => {
    it("no se renderiza si parcelsCount=0 y highAlertsCount=0", () => {
      render(
        <AppShell activeSection="dashboard" eyebrow="x" highAlertsCount={0} parcelsCount={0} title="t" />
      );
      expect(screen.queryByText(/estado actual/i)).not.toBeInTheDocument();
    });

    it("se renderiza si parcelsCount > 0", () => {
      render(
        <AppShell activeSection="dashboard" eyebrow="x" parcelsCount={12} title="t" />
      );
      expect(screen.getByText(/estado actual/i)).toBeInTheDocument();
      expect(screen.getByText("12")).toBeInTheDocument();
    });

    it("se renderiza si highAlertsCount > 0", () => {
      render(
        <AppShell activeSection="dashboard" eyebrow="x" highAlertsCount={3} title="t" />
      );
      expect(screen.getByText(/estado actual/i)).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
    });

    it("muestra ambos contadores cuando los dos son > 0", () => {
      render(
        <AppShell
          activeSection="dashboard"
          eyebrow="x"
          highAlertsCount={2}
          parcelsCount={50}
          title="t"
        />
      );
      expect(screen.getByText("50")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  // ============================================================
  // v1.5 — Sidebar gate: ocultar /devices para supervisores
  // ============================================================
  describe("viewerRole (v1.5 sidebar gate)", () => {
    it("oculta /devices del sidebar cuando viewerRole='supervisor'", () => {
      // El supervisor sigue viendo los 5 items permitidos, pero NO
      // Dispositivos. La defensa real es el server-side redirect en
      // /devices/page.tsx; este gate es solo cosmético.
      render(
        <AppShell
          activeSection="dashboard"
          eyebrow="x"
          title="t"
          viewerRole="supervisor"
        />
      );
      expect(screen.queryByRole("link", { name: /dispositivos/i })).not.toBeInTheDocument();
      // Los 5 items no-admin siguen visibles.
      expect(screen.getByRole("link", { name: /panel/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /mapa/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /historial/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /^parcelas$/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /faltan por fumigar/i })).toBeInTheDocument();
    });

    it("muestra /devices cuando viewerRole='admin'", () => {
      render(
        <AppShell
          activeSection="dashboard"
          eyebrow="x"
          title="t"
          viewerRole="admin"
        />
      );
      expect(screen.getByRole("link", { name: /dispositivos/i })).toHaveAttribute("href", "/devices");
    });

    it("muestra /devices cuando viewerRole=null (default, sin sesion o loading)", () => {
      // Sin prop: comportamiento default. Mostrar todo es menos roto
      // que esconder todo (defensa: si no sabemos el role, no
      // asumimos supervisor).
      const { rerender } = render(
        <AppShell activeSection="dashboard" eyebrow="x" title="t" />
      );
      expect(screen.getByRole("link", { name: /dispositivos/i })).toBeInTheDocument();

      // Tambien con null explicito
      rerender(
        <AppShell
          activeSection="dashboard"
          eyebrow="x"
          title="t"
          viewerRole={null}
        />
      );
      expect(screen.getByRole("link", { name: /dispositivos/i })).toBeInTheDocument();
    });

    it("el filtro del sidebar desktop se refleja en el drawer mobile", () => {
      // El drawer recibe `visibleNav` (filtrado), no `sidebarNav` (full).
      // Verificamos que NO se renderiza un link a /devices cuando
      // viewerRole=supervisor y el drawer esta abierto.
      render(
        <AppShell
          activeSection="dashboard"
          eyebrow="x"
          title="t"
          viewerRole="supervisor"
        />
      );
      // El drawer esta cerrado por default. Lo abrimos y verificamos.
      const burger = screen.getByRole("button", { name: /abrir menú/i });
      act(() => {
        burger.click();
      });
      // El link "Dispositivos" NO debe existir en el drawer mobile.
      expect(screen.queryByRole("link", { name: /dispositivos/i })).not.toBeInTheDocument();
    });
  });
});
