import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AppShell } from "@/components/app-shell";

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
});
