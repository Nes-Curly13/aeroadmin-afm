// tests/components/parcels/interval-chart.test.tsx
//
// Tests del IntervalChart (Sprint v0.1 — port del V0).
// Cubre:
//   - Empty state cuando hay < 2 puntos.
//   - Render de N barras (1 por point).
//   - Línea de cadencia (umbral) presente en el SVG.
//   - Color de cada barra según la regla de 3 niveles.
//   - Labels de fecha en los extremos.
//   - Leyenda inline con los 3 rangos.
//   - Tooltip nativo (<title>) en cada barra.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { IntervalChart, type IntervalPoint } from "@/components/parcels/interval-chart";

function makePoints(values: Array<[string, number]>): IntervalPoint[] {
  return values.map(([date, gap]) => ({ date, gap }));
}

describe("IntervalChart", () => {
  it("empty state con 0 puntos", () => {
    render(<IntervalChart points={[]} cadenceDays={14} />);
    const empty = screen.getByTestId("interval-chart-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/se necesitan al menos dos/i);
  });

  it("empty state con 1 punto (insuficiente para calcular intervalos)", () => {
    render(<IntervalChart points={[{ date: "2026-07-15", gap: 14 }]} cadenceDays={14} />);
    expect(screen.getByTestId("interval-chart-empty")).toBeInTheDocument();
  });

  it("renderiza el SVG con N barras (1 por point)", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 16],
      ["2026-06-15", 22]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const svg = screen.getByTestId("interval-chart-svg");
    expect(svg).toBeInTheDocument();
    expect(within(svg).getByTestId("interval-chart-bar-0")).toBeInTheDocument();
    expect(within(svg).getByTestId("interval-chart-bar-1")).toBeInTheDocument();
    expect(within(svg).getByTestId("interval-chart-bar-2")).toBeInTheDocument();
  });

  it("dibuja la línea horizontal de cadencia (umbral) con stroke-dasharray", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 14]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const line = screen.getByTestId("interval-chart-threshold");
    expect(line).toBeInTheDocument();
    expect(line.tagName.toLowerCase()).toBe("line");
    expect(line.getAttribute("stroke-dasharray")).toBe("4 4");
  });

  it("color VERDE cuando gap <= cadencia + 2 (en ventana)", () => {
    // Cadencia 14, threshold = 16. gap=16 → verde (límite inclusivo).
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 16]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const bar = within(screen.getByTestId("interval-chart-svg")).getByTestId(
      "interval-chart-bar-1"
    );
    const rect = bar.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("#0b5f2d");
  });

  it("color AMARILLO cuando cadencia + 2 < gap <= cadencia * 1.5", () => {
    // Cadencia 14, threshold1 = 16, threshold2 = 21.
    // gap=18 → amarillo (entre 16 y 21).
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-06-27", 18]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const bar = within(screen.getByTestId("interval-chart-svg")).getByTestId(
      "interval-chart-bar-1"
    );
    const rect = bar.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("#d4b23c");
  });

  it("color ROJO cuando gap > cadencia * 1.5 (atraso severo)", () => {
    // Cadencia 14, threshold2 = 21. gap=25 → rojo.
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-06-20", 25]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const bar = within(screen.getByTestId("interval-chart-svg")).getByTestId(
      "interval-chart-bar-1"
    );
    const rect = bar.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("#a93232");
  });

  it("primera y última fecha se muestran como labels del eje X", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 14]
    ]);
    const { container } = render(<IntervalChart points={points} cadenceDays={14} />);
    const svgText = container.querySelector("svg")?.textContent ?? "";
    // formatDate devuelve "Mon DD, YYYY" (en-US locale) — verificamos
    // que el año está presente (los meses/días dependen del locale de
    // jsdom, no son estables). Mínimo verificamos que los años 2026
    // aparecen 2 veces.
    expect((svgText.match(/2026/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("leyenda inline muestra los 3 rangos con sus colores", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 14]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const legend = screen.getByTestId("interval-chart-legend");
    expect(legend.textContent).toMatch(/≤ 16 d/); // cadenceDays + 2
    expect(legend.textContent).toMatch(/> 16 d/);
    expect(legend.textContent).toMatch(/> 21 d/); // round(cadenceDays * 1.5)
  });

  it("cada barra tiene <title> (tooltip nativo) con la fecha y el gap", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 16]
    ]);
    const { container } = render(<IntervalChart points={points} cadenceDays={14} />);
    // El <g> del bar 0 contiene un <title> con el texto formateado.
    const bar0 = within(container).getByTestId("interval-chart-bar-0");
    const title = bar0.querySelector("title");
    expect(title).not.toBeNull();
    // El <title> del <g> describe el bar en lenguaje natural.
    expect(title?.textContent).toMatch(/jul/i);
    expect(title?.textContent).toMatch(/14 días/i);
  });

  it("data-slot está presente (regla dura del proyecto)", () => {
    const points = makePoints([
      ["2026-07-15", 14],
      ["2026-07-01", 14]
    ]);
    render(<IntervalChart points={points} cadenceDays={14} />);
    const root = screen.getByTestId("interval-chart");
    expect(root.getAttribute("data-slot")).toBe("interval-chart");
  });

  it("tolera cadencia = 0 (no se renderiza la línea de cadencia, pero funciona)", () => {
    // Edge case: si por algún motivo la cadencia viene en 0, no rompemos.
    // La línea de cadencia se dibujaría en y=MARGIN_TOP (arriba del todo),
    // y todos los gaps serían amarillos/rojos.
    const points = makePoints([
      ["2026-07-15", 5],
      ["2026-07-10", 5]
    ]);
    expect(() => render(<IntervalChart points={points} cadenceDays={0} />)).not.toThrow();
  });
});
