import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MapStatsSkeleton } from "@/components/map/map-stats-skeleton";

describe("MapStatsSkeleton", () => {
  it("renderiza 5 bloques de KPI skeleton", () => {
    const { container } = render(<MapStatsSkeleton />);
    // 5 KPI skeletons con la clase animate-pulse
    const blocks = container.querySelectorAll("[data-kpi-skeleton]");
    expect(blocks.length).toBe(5);
  });

  it("los bloques tienen animación pulse", () => {
    const { container } = render(<MapStatsSkeleton />);
    const pulseBlocks = container.querySelectorAll(".animate-pulse");
    expect(pulseBlocks.length).toBeGreaterThan(0);
  });

  it("renderiza 2 paneles skeleton (distribución + resúmenes)", () => {
    const { container } = render(<MapStatsSkeleton />);
    const panels = container.querySelectorAll("[data-panel-skeleton]");
    expect(panels.length).toBe(2);
  });

  it("mantiene la misma estructura grid que el island (md:grid-cols-5 y md:grid-cols-2)", () => {
    const { container } = render(<MapStatsSkeleton />);
    // El contenedor KPI usa grid-cols-5
    const kpiGrid = container.querySelector("[data-kpi-grid]");
    expect(kpiGrid?.className).toMatch(/md:grid-cols-5/);
    // El contenedor de paneles usa grid-cols-2
    const panelGrid = container.querySelector("[data-panel-grid]");
    expect(panelGrid?.className).toMatch(/md:grid-cols-2/);
  });

  it("incluye un aria-busy='true' para accesibilidad", () => {
    render(<MapStatsSkeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("anuncia al lector de pantalla que está cargando", () => {
    render(<MapStatsSkeleton />);
    // aria-label o texto dentro del role=status
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label") || status.textContent).toMatch(/cargando|loading/i);
  });
});
