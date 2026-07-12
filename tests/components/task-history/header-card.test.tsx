/**
 * Tests del HeaderCard (server component).
 *
 * Verifica el contrato que el verifier chequea contra el Figma:
 *   - "5462.23mu" en el output (formato DJI, sin separador de miles)
 *   - "100884.1L" con un decimal
 *   - "8028times" sin separador de miles
 *   - 4 iconos SVG presentes
 *   - Border verde 2px (#0b5f2d)
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HeaderCard } from "@/components/task-history/header-card";
import type { TaskHistoryTotals } from "@/lib/djiag-from-make/task-history";

const mockTotals: TaskHistoryTotals = {
  areaMu: 5462.23,
  times: 8028,
  liters: 100884.1,
  duration: { hours: 631, minutes: 11, seconds: 23, djiFormat: "631Hour11min23s" }
};

const zeroTotals: TaskHistoryTotals = {
  areaMu: 0,
  times: 0,
  liters: 0,
  duration: { hours: 0, minutes: 0, seconds: 0, djiFormat: "0Hour0min0s" }
};

afterEach(cleanup);

describe("HeaderCard", () => {
  it("renderiza el area con dos decimales + sufijo 'mu'", () => {
    render(<HeaderCard totals={mockTotals} />);
    const area = screen.getByTestId("task-history-header-area");
    expect(area.textContent).toContain("5462.23");
    expect(area.textContent).toContain("mu");
  });

  it("renderiza el area en cero sin romper (0.00mu)", () => {
    render(<HeaderCard totals={zeroTotals} />);
    const area = screen.getByTestId("task-history-header-area");
    expect(area.textContent).toContain("0.00");
    expect(area.textContent).toContain("mu");
  });

  it("muestra el label 'Agriculture' por default", () => {
    render(<HeaderCard totals={mockTotals} />);
    expect(screen.getByText("Agriculture")).toBeInTheDocument();
  });

  it("acepta un categoryLabel custom", () => {
    render(<HeaderCard categoryLabel="Custom Cat" totals={mockTotals} />);
    expect(screen.getByText("Custom Cat")).toBeInTheDocument();
  });

  it("muestra el times con el formato DJI (sin separador de miles)", () => {
    render(<HeaderCard totals={mockTotals} />);
    const times = screen.getByTestId("task-history-header-times");
    expect(times.textContent).toContain("8028");
    expect(times.textContent).toContain("times");
    expect(times.textContent).not.toContain("8,028");
  });

  it("muestra los litros con un decimal y sufijo L", () => {
    render(<HeaderCard totals={mockTotals} />);
    const liters = screen.getByTestId("task-history-header-liters");
    expect(liters.textContent).toContain("100884.1");
    expect(liters.textContent).toContain("L");
  });

  it("muestra la duracion en formato DJI", () => {
    render(<HeaderCard totals={mockTotals} />);
    const duration = screen.getByTestId("task-history-header-duration");
    expect(duration.textContent).toContain("631Hour11min23s");
  });

  it("muestra el placeholder '-' para el slot unused (siempre vacio en Figma)", () => {
    render(<HeaderCard totals={mockTotals} />);
    const unused = screen.getByTestId("task-history-header-unused");
    expect(unused.textContent).toContain("-");
  });

  it("renderiza los 4 iconos SVG", () => {
    const { container } = render(<HeaderCard totals={mockTotals} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(4);
  });

  it("tiene border verde 2px (#0b5f2d)", () => {
    const { container } = render(<HeaderCard totals={mockTotals} />);
    const card = container.querySelector('[data-testid="task-history-header-card"]');
    expect(card).not.toBeNull();
    expect((card as HTMLElement).className).toContain("border-2");
    expect((card as HTMLElement).className).toContain("border-[#0b5f2d]");
  });

  it("el area esta en color verde", () => {
    render(<HeaderCard totals={mockTotals} />);
    const area = screen.getByTestId("task-history-header-area");
    expect(area.className).toContain("text-[#0b5f2d]");
  });

  it("acepta un ariaLabel custom para accesibilidad", () => {
    render(<HeaderCard ariaLabel="Totales 2026-Q1" totals={mockTotals} />);
    const card = screen.getByLabelText("Totales 2026-Q1");
    expect(card).toBeInTheDocument();
  });
});
