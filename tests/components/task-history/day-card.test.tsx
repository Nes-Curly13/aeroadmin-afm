/**
 * Tests del DayCard (server component).
 *
 * Verifica:
 *   - Titulo con date+weekday concatenados (formato DJI: "2026/07/08Wednesday")
 *   - Divider visible
 *   - "Agriculture X.XXmu" en el cuerpo
 *   - Grilla 2x2 con SVG por icono
 *   - data-date attribute (util para selectors)
 *   - aria-label descriptivo
 *   - v1.7 Track C: sub-lista opcional de vuelos (FlightSubList) cuando
 *     se pasa `flights`; click handler opcional cuando se pasa
 *     `onFlightClick`.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DayCard } from "@/components/task-history/day-card";
import type {
  DayCard as DayCardData,
  FlightListItem
} from "@/lib/djiag-from-make/task-history";

const mockDay: DayCardData = {
  date: "2026/07/08",
  weekday: "Wednesday",
  areaMu: 18.29,
  times: 22,
  liters: 365.2,
  duration: { hours: 1, minutes: 44, seconds: 53, djiFormat: "1Hour44min53s" }
};

const dayWithoutWeekday: DayCardData = {
  date: "2026/07/01",
  weekday: "",
  areaMu: 10,
  times: 5,
  liters: 100,
  duration: { hours: 0, minutes: 30, seconds: 0, djiFormat: "0Hour30min0s" }
};

function makeFlight(overrides: Partial<FlightListItem> = {}): FlightListItem {
  return {
    id: 123,
    localDate: "2026-07-08",
    localTime: "09:14",
    durationSeconds: 1800,
    areaMu: 12.5,
    liters: 250,
    droneSerial: "1581F5BKD23100045",
    pilotName: "Breiner",
    parcelId: 42,
    ...overrides
  };
}

afterEach(cleanup);

describe("DayCard", () => {
  it("renderiza el header con date+weekday concatenados", () => {
    render(<DayCard day={mockDay} />);
    const card = screen.getByTestId("task-history-day-card");
    const title = card.querySelector("h3");
    expect(title).not.toBeNull();
    expect(title!.textContent).toContain("2026/07/08");
    expect(title!.textContent).toContain("Wednesday");
    // No space between date and weekday (DJI los pega)
    expect(title!.textContent).toMatch(/2026\/07\/08Wednesday/);
  });

  it("muestra 'Agriculture' + area con dos decimales + sufijo mu", () => {
    render(<DayCard day={mockDay} />);
    expect(screen.getByText("Agriculture")).toBeInTheDocument();
    const area = screen.getByTestId("task-history-day-card-area");
    expect(area.textContent).toContain("18.29");
    expect(area.textContent).toContain("mu");
  });

  it("muestra el divider", () => {
    const { container } = render(<DayCard day={mockDay} />);
    const divider = screen.getByTestId("task-history-day-card-divider");
    expect(divider).toBeInTheDocument();
    // border-t = border-top
    expect(divider.className).toContain("border-t");
  });

  it("muestra los 4 metricos (times, liters, unused, duration) con SVG", () => {
    const { container } = render(<DayCard day={mockDay} />);
    expect(screen.getByTestId("task-history-day-card-grid-times").textContent).toContain("22");
    expect(screen.getByTestId("task-history-day-card-grid-liters").textContent).toContain("365.2");
    expect(screen.getByTestId("task-history-day-card-grid-unused").textContent).toContain("-");
    expect(screen.getByTestId("task-history-day-card-grid-duration").textContent).toContain("1Hour44min53s");
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(4);
  });

  it("tiene el atributo data-date para selectors", () => {
    const { container } = render(<DayCard day={mockDay} />);
    const card = container.querySelector('[data-date="2026/07/08"]');
    expect(card).not.toBeNull();
  });

  it("acepta un categoryLabel custom", () => {
    render(<DayCard categoryLabel="Mi Cultivo" day={mockDay} />);
    expect(screen.getByText("Mi Cultivo")).toBeInTheDocument();
  });

  it("acepta un ariaLabel custom", () => {
    render(<DayCard ariaLabel="Dia de prueba" day={mockDay} />);
    expect(screen.getByLabelText("Dia de prueba")).toBeInTheDocument();
  });

  it("auto-genera aria-label con prefijo 'Fumigaciones del' cuando no se pasa", () => {
    render(<DayCard day={mockDay} />);
    const card = screen.getByTestId("task-history-day-card");
    expect(card.getAttribute("aria-label")).toContain("Fumigaciones del 2026/07/08");
  });

  it("auto-genera aria-label sin weekday cuando weekday esta vacio", () => {
    render(<DayCard day={dayWithoutWeekday} />);
    const card = screen.getByTestId("task-history-day-card");
    const aria = card.getAttribute("aria-label") ?? "";
    expect(aria).toContain("2026/07/01");
    // No trailing double space
    expect(aria).not.toMatch(/\s\s/);
  });

  it("renderiza area en cero (0.00mu) sin romper", () => {
    const zeroDay: DayCardData = {
      date: "2026/07/01",
      weekday: "Tuesday",
      areaMu: 0,
      times: 0,
      liters: 0,
      duration: { hours: 0, minutes: 0, seconds: 0, djiFormat: "0Hour0min0s" }
    };
    render(<DayCard day={zeroDay} />);
    const area = screen.getByTestId("task-history-day-card-area");
    expect(area.textContent).toContain("0.00");
    expect(area.textContent).toContain("mu");
  });

  it("renderiza el area con estilo verde", () => {
    render(<DayCard day={mockDay} />);
    const area = screen.getByTestId("task-history-day-card-area");
    expect(area.className).toContain("text-[#0b5f2d]");
  });

  it("el card wrapper tiene border gris claro (no verde)", () => {
    const { container } = render(<DayCard day={mockDay} />);
    const card = screen.getByTestId("task-history-day-card");
    expect(card.className).toContain("border");
    // DayCard usa border por defecto (gris #d2ddd6), no border-2 verde
    expect(card.className).not.toContain("border-2");
  });

  it("renderiza la grilla 2x2 con grid grid-cols-2", () => {
    render(<DayCard day={mockDay} />);
    const grid = screen.getByTestId("task-history-day-card-grid");
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("grid-cols-2");
  });

  // ==========================================================
  // v1.7 Track C — sub-lista opcional de vuelos
  // ==========================================================
  describe("v1.7 Track C — sub-lista de vuelos", () => {
    it("NO renderiza la sub-lista si no se pasa `flights` (back-compat)", () => {
      render(<DayCard day={mockDay} />);
      expect(screen.queryByTestId("task-history-flight-sub-list")).toBeNull();
    });

    it("NO renderiza la sub-lista si `flights=[]`", () => {
      render(<DayCard day={mockDay} flights={[]} />);
      expect(screen.queryByTestId("task-history-flight-sub-list")).toBeNull();
    });

    it("SÍ renderiza la sub-lista si se pasa `flights` con 1+ items", () => {
      const flights = [makeFlight()];
      render(<DayCard day={mockDay} flights={flights} />);
      expect(screen.getByTestId("task-history-flight-sub-list")).toBeInTheDocument();
      const items = screen.getAllByTestId("task-history-flight-sub-list-item");
      expect(items).toHaveLength(1);
    });

    it("la sub-lista muestra HH:MM, drone (acortado), piloto, area, duration", () => {
      const flights = [makeFlight()];
      render(<DayCard day={mockDay} flights={flights} />);
      const sub = screen.getByTestId("task-history-flight-sub-list");
      const text = sub.textContent ?? "";
      expect(text).toContain("09:14");
      // Drone serial acortado a "…00045" (últimos 5 chars)
      expect(text).toContain("…00045");
      // Piloto
      expect(text).toContain("Breiner");
      // Area con 1 decimal
      expect(text).toContain("12.5");
      expect(text).toContain("mu");
      // Duration 1800s = 30min → "30m"
      expect(text).toContain("30m");
    });

    it("renderiza items como <div> no-clickeables cuando no se pasa onFlightClick", () => {
      const flights = [makeFlight()];
      render(<DayCard day={mockDay} flights={flights} />);
      const item = screen.getByTestId("task-history-flight-sub-list-item");
      // No es un botón → no se puede "clickear" como control
      expect(item.tagName).not.toBe("BUTTON");
    });

    it("renderiza items como <button> clickeables cuando se pasa onFlightClick", () => {
      const onClick = vi.fn();
      const flights = [makeFlight({ id: 999 })];
      render(<DayCard day={mockDay} flights={flights} onFlightClick={onClick} />);
      const item = screen.getByTestId("task-history-flight-sub-list-item");
      expect(item.tagName).toBe("BUTTON");
      item.click();
      expect(onClick).toHaveBeenCalledTimes(1);
      // El handler recibe el FlightListItem completo, no solo el id
      expect(onClick).toHaveBeenCalledWith(
        expect.objectContaining({ id: 999, pilotName: "Breiner" })
      );
    });

    it("muestra data-flight-id en cada item para que tests E2E puedan targetearlo", () => {
      const flights = [makeFlight({ id: 777 }), makeFlight({ id: 778 })];
      render(<DayCard day={mockDay} flights={flights} />);
      const items = screen.getAllByTestId("task-history-flight-sub-list-item");
      expect(items[0].getAttribute("data-flight-id")).toBe("777");
      expect(items[1].getAttribute("data-flight-id")).toBe("778");
    });

    it("muestra 'N vuelos más' cuando flights.length > MAX_VISIBLE_FLIGHTS (5)", () => {
      const flights = Array.from({ length: 8 }, (_, i) =>
        makeFlight({ id: 1000 + i })
      );
      render(<DayCard day={mockDay} flights={flights} />);
      const items = screen.getAllByTestId("task-history-flight-sub-list-item");
      expect(items).toHaveLength(5);
      // 8 - 5 = 3 → "+3 vuelos más"
      const more = screen.getByTestId("task-history-flight-sub-list-more");
      expect(more.textContent).toContain("+3");
      expect(more.textContent).toContain("vuelos");
    });

    it("muestra '1 vuelo más' (singular) cuando sobra exactamente 1", () => {
      const flights = Array.from({ length: 6 }, (_, i) =>
        makeFlight({ id: 2000 + i })
      );
      render(<DayCard day={mockDay} flights={flights} />);
      const more = screen.getByTestId("task-history-flight-sub-list-more");
      expect(more.textContent).toContain("+1");
      expect(more.textContent).toContain("vuelo");
      // No plural
      expect(more.textContent).not.toContain("vuelos");
    });
  });
});
