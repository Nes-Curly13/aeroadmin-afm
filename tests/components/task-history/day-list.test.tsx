/**
 * Tests del DayList (server component).
 *
 * Verifica:
 *   - Fallback "No hay fumigaciones en este rango" cuando days=[]
 *   - Custom emptyMessage
 *   - 1 DayCard por dia del array
 *   - Orden preservado
 *   - data-count attribute
 *   - aria-label
 *   - Custom ariaLabel
 *   - Render con un unico dia con todos los campos del verifier
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DayList } from "@/components/task-history/day-list";
import type { DayCard as DayCardData } from "@/lib/djiag-from-make/task-history";

const baseDay = (overrides: Partial<DayCardData> = {}): DayCardData => ({
  date: "2026/07/08",
  weekday: "Wednesday",
  areaMu: 18.29,
  times: 22,
  liters: 365.2,
  duration: { hours: 1, minutes: 44, seconds: 53, djiFormat: "1Hour44min53s" },
  ...overrides
});

afterEach(cleanup);

describe("DayList", () => {
  it("muestra el fallback 'No hay fumigaciones en este rango' cuando days=[]", () => {
    render(<DayList days={[]} />);
    const empty = screen.getByTestId("task-history-day-list-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain("No hay fumigaciones en este rango");
  });

  it("acepta un emptyMessage custom", () => {
    render(<DayList days={[]} emptyMessage="Sin datos en el periodo" />);
    const empty = screen.getByTestId("task-history-day-list-empty");
    expect(empty.textContent).toContain("Sin datos en el periodo");
    expect(empty.textContent).not.toContain("No hay fumigaciones");
  });

  it("renderiza un DayCard por cada dia del array", () => {
    const days = [
      baseDay({ date: "2026/07/08", weekday: "Wednesday" }),
      baseDay({ date: "2026/07/07", weekday: "Tuesday", areaMu: 20.91 }),
      baseDay({ date: "2026/07/06", weekday: "Monday", areaMu: 15.0 })
    ];
    render(<DayList days={days} />);
    const cards = screen.getAllByTestId("task-history-day-card");
    expect(cards).toHaveLength(3);
  });

  it("preserva el orden de los dias (la API devuelve DESC)", () => {
    const days = [
      baseDay({ date: "2026/07/08", weekday: "Wednesday" }),
      baseDay({ date: "2026/07/07", weekday: "Tuesday" }),
      baseDay({ date: "2026/07/06", weekday: "Monday" })
    ];
    const { container } = render(<DayList days={days} />);
    const cards = container.querySelectorAll('[data-testid="task-history-day-card"]');
    expect(cards[0].getAttribute("data-date")).toBe("2026/07/08");
    expect(cards[1].getAttribute("data-date")).toBe("2026/07/07");
    expect(cards[2].getAttribute("data-date")).toBe("2026/07/06");
  });

  it("renderiza data-count con la cantidad de dias", () => {
    const days = [baseDay(), baseDay({ date: "2026/07/07" })];
    render(<DayList days={days} />);
    const list = screen.getByTestId("task-history-day-list");
    expect(list.getAttribute("data-count")).toBe("2");
  });

  it("acepta un ariaLabel custom", () => {
    const days = [baseDay()];
    render(<DayList ariaLabel="Mi lista" days={days} />);
    expect(screen.getByLabelText("Mi lista")).toBeInTheDocument();
  });

  it("aplica un spacingClass custom", () => {
    const days = [baseDay(), baseDay({ date: "2026/07/07" })];
    render(<DayList days={days} spacingClass="grid grid-cols-1 gap-6" />);
    const list = screen.getByTestId("task-history-day-list");
    expect(list.className).toContain("grid-cols-1");
    expect(list.className).toContain("gap-6");
  });

  it("renderiza un unico dia con todos los campos del verifier (18.29mu, 1Hour44min53s, 22times, 365.2L)", () => {
    render(<DayList days={[baseDay()]} />);
    const card = screen.getByTestId("task-history-day-card");
    expect(card.textContent).toContain("2026/07/08");
    expect(card.textContent).toContain("Wednesday");
    expect(card.textContent).toContain("18.29");
    expect(card.textContent).toContain("mu");
    expect(card.textContent).toContain("22");
    expect(card.textContent).toContain("times");
    expect(card.textContent).toContain("365.2");
    expect(card.textContent).toContain("L");
    expect(card.textContent).toContain("1Hour44min53s");
  });

  it("no muestra el fallback cuando hay al menos un dia", () => {
    render(<DayList days={[baseDay()]} />);
    expect(screen.queryByTestId("task-history-day-list-empty")).toBeNull();
  });
});
