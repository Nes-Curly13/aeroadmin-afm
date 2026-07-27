import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { MapLegend } from "@/components/map/map-legend";

/**
 * Tests del MapLegend (v1.8 — rediseño).
 *
 * Cambio respecto a v1.7:
 *   - v1.7: 3 grupos semánticos (Parcelas/Alertas/Vuelos) con checkboxes
 *     de toggle de capa + indicadores visuales. El legend mezclaba
 *     "key visual" con "toggles de capa".
 *   - v1.8: 4 indicadores visuales puros (Parcela activa, Parcela
 *     inactiva, En vuelo, Completado) SIN toggles. Los toggles de capa
 *     viven ahora en el `<LayersControl>` nativo de Leaflet.
 *   - v1.8: el panel es colapsable (default abierto), con un botón
 *     chevron en el header.
 *
 * Tokens (de `lib/ui-tokens.ts`):
 *   - Parcela activa    → `primary`   #0b5f2d (verde)
 *   - Parcela inactiva  → `neutral-medium` #587064 (gris, dashed)
 *   - En vuelo          → `info`      #1f4d80 (azul)
 *   - Completado        → `completed` #a855f7 (morado)
 */

describe("MapLegend — v1.8 (key visual puro)", () => {
  it("renderiza las 4 entradas con sus labels", () => {
    render(<MapLegend />);
    expect(screen.getByText(/parcela activa/i)).toBeInTheDocument();
    expect(screen.getByText(/parcela inactiva/i)).toBeInTheDocument();
    expect(screen.getByText(/en vuelo/i)).toBeInTheDocument();
    expect(screen.getByText(/completado/i)).toBeInTheDocument();
  });

  it("NO tiene toggles (los checkboxes viven en el LayersControl de Leaflet)", () => {
    render(<MapLegend />);
    // Cero checkboxes — el legend es solo key visual.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("tiene aria-label claro en el contenedor principal", () => {
    render(<MapLegend ariaLabel="Leyenda del mapa" />);
    expect(screen.getByRole("region", { name: /leyenda del mapa/i })).toBeInTheDocument();
  });

  it("el header tiene un botón colapsable con aria-expanded", () => {
    render(<MapLegend />);
    const toggle = screen.getByTestId("map-legend-toggle");
    expect(toggle).toBeInTheDocument();
    // Default abierto → aria-expanded="true".
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("al clickear el toggle el panel se colapsa y oculta los indicadores", () => {
    render(<MapLegend />);
    const toggle = screen.getByTestId("map-legend-toggle");
    // Inicialmente los 4 indicadores están visibles.
    expect(screen.getByTestId("map-legend-content")).toBeInTheDocument();
    expect(screen.getByText(/parcela activa/i)).toBeInTheDocument();

    // Click en el toggle.
    fireEvent.click(toggle);

    // Ahora el panel está colapsado: aria-expanded="false" y el
    // content está desmontado.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("map-legend-content")).toBeNull();
    expect(screen.queryByText(/parcela activa/i)).toBeNull();
  });

  it("al clickear el toggle 2 veces, vuelve a estar abierto", () => {
    render(<MapLegend />);
    const toggle = screen.getByTestId("map-legend-toggle");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("map-legend-content")).toBeInTheDocument();
  });

  it("defaultCollapsed=true arranca colapsado", () => {
    render(<MapLegend defaultCollapsed={true} />);
    const toggle = screen.getByTestId("map-legend-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("map-legend-content")).toBeNull();
  });

  it("indicador 'Parcela activa' usa color primary (verde)", () => {
    render(<MapLegend />);
    const row = screen.getByText(/parcela activa/i).parentElement;
    const dot = row?.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe("rgb(11, 95, 45)"); // #0b5f2d primary
  });

  it("indicador 'Parcela inactiva' usa color gris con dashed border", () => {
    render(<MapLegend />);
    const row = screen.getByText(/parcela inactiva/i).parentElement;
    const dot = row?.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe("rgb(88, 112, 100)"); // #587064 neutral-medium
    expect(dot.style.borderStyle).toBe("dashed");
  });

  it("indicador 'En vuelo' usa color info (azul)", () => {
    render(<MapLegend />);
    const row = screen.getByText(/en vuelo/i).parentElement;
    const dot = row?.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe("rgb(31, 77, 128)"); // #1f4d80 info
  });

  it("indicador 'Completado' usa color completed (morado)", () => {
    render(<MapLegend />);
    const row = screen.getByText(/completado/i).parentElement;
    const dot = row?.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe("rgb(168, 85, 247)"); // #a855f7 completed
  });

  it("el contenedor tiene un header con el titulo 'Leyenda'", () => {
    render(<MapLegend />);
    expect(screen.getByRole("heading", { name: "Leyenda" })).toBeInTheDocument();
  });
});
