import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { MapLegend } from "@/components/map/map-legend";

describe("MapLegend", () => {
  const LAYERS = { parcels: true, flights: false, alerts: true };

  it("renderiza las 3 entradas con sus labels", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    expect(screen.getByText(/fumigadas/i)).toBeInTheDocument();
    expect(screen.getByText(/sin fumigar/i)).toBeInTheDocument();
    expect(screen.getByText(/orchards/i)).toBeInTheDocument();
    expect(screen.getByText(/alta/i)).toBeInTheDocument();
    expect(screen.getByText(/media/i)).toBeInTheDocument();
    expect(screen.getByText(/baja/i)).toBeInTheDocument();
    expect(screen.getByText(/vuelos/i)).toBeInTheDocument();
  });

  it("agrupa visualmente con headers 'Parcelas', 'Alertas' y 'Vuelos'", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    // Los headers de grupo son texto en uppercase / eyebrow.
    expect(screen.getByText(/parcelas/i)).toBeInTheDocument();
    expect(screen.getByText(/alertas/i)).toBeInTheDocument();
    expect(screen.getByText(/vuelos/i)).toBeInTheDocument();
  });

  it("los toggles de capas (parcels, flights, alerts) siguen funcionando", () => {
    const onToggle = vi.fn();
    render(<MapLegend layers={LAYERS} onToggle={onToggle} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(onToggle).toHaveBeenCalledWith("parcels");
    fireEvent.click(checkboxes[1]);
    expect(onToggle).toHaveBeenCalledWith("flights");
    fireEvent.click(checkboxes[2]);
    expect(onToggle).toHaveBeenCalledWith("alerts");
  });

  it("cada checkbox refleja el estado de su layer", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });

  it("los indicadores fumigadas/sin fumigar/orchards NO son toggles (sin checkbox)", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    // Solo hay 3 checkboxes (parcels, flights, alerts).
    // Los indicadores visuales (fumigadas, sin fumigar, orchards, alta, media, baja)
    // son <span> / <div>, no <input>.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);
  });

  it("tiene aria-label claro en el contenedor principal", () => {
    render(<MapLegend ariaLabel="Leyenda del mapa" layers={LAYERS} onToggle={() => {}} />);
    expect(screen.getByRole("region", { name: /leyenda del mapa/i })).toBeInTheDocument();
  });

  it("cada grupo tiene aria-label descriptivo", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    expect(screen.getByRole("group", { name: /parcelas/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /alertas/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /vuelos/i })).toBeInTheDocument();
  });

  it("indicador fumigadas tiene dot del color primary (verde)", () => {
    const { container } = render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const group = screen.getByRole("group", { name: /parcelas/i });
    const fumigadasRow = within(group).getByText(/fumigadas/i).parentElement;
    const dot = fumigadasRow?.querySelector("[aria-hidden='true']");
    expect(dot).toBeTruthy();
    // Estilo inline: backgroundColor con el color primary
    expect((dot as HTMLElement).style.backgroundColor).toBe("rgb(11, 95, 45)"); // #0b5f2d
  });

  it("indicador sin fumigar tiene dot con dashed border (no solido)", () => {
    const { container } = render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const group = screen.getByRole("group", { name: /parcelas/i });
    const sinFumigarRow = within(group).getByText(/sin fumigar/i).parentElement;
    const dot = sinFumigarRow?.querySelector("[aria-hidden='true']") as HTMLElement | null;
    expect(dot).toBeTruthy();
    // Indicador visual: dashed border en el dot.
    expect(dot?.style.borderStyle).toBe("dashed");
  });

  it("indicador orchards tiene dot del color warning (amarillo)", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const group = screen.getByRole("group", { name: /parcelas/i });
    const orchardsRow = within(group).getByText(/orchards/i).parentElement;
    const dot = orchardsRow?.querySelector("[aria-hidden='true']") as HTMLElement | null;
    expect(dot).toBeTruthy();
    expect(dot?.style.backgroundColor).toBe("rgb(199, 164, 58)"); // #c7a43a
  });

  it("indicadores de alertas alta/media/baja usan tokens danger/warning/success", () => {
    render(<MapLegend layers={LAYERS} onToggle={() => {}} />);
    const group = screen.getByRole("group", { name: /alertas/i });
    const altaDot = within(group).getByText(/alta/i).parentElement?.querySelector("[aria-hidden='true']") as HTMLElement;
    const mediaDot = within(group).getByText(/media/i).parentElement?.querySelector("[aria-hidden='true']") as HTMLElement;
    const bajaDot = within(group).getByText(/baja/i).parentElement?.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(altaDot.style.backgroundColor).toBe("rgb(169, 50, 50)"); // #a93232 danger
    expect(mediaDot.style.backgroundColor).toBe("rgb(199, 164, 58)"); // #c7a43a warning
    expect(bajaDot.style.backgroundColor).toBe("rgb(44, 127, 68)"); // #2c7f44 success
  });
});
