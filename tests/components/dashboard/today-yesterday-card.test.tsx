// tests/components/dashboard/today-yesterday-card.test.tsx
//
// Sprint A — F4.0: tests del card "Ayer + Hoy" del dashboard.
//
// Cobertura:
//   - Renderiza ambos sub-cards con los 4 metrics cada uno.
//   - Muestra empty state inline cuando un día está en 0.
//   - Formatea el duration_minutes como "Xh Ym" / "Xh" / "Ym" / "0m".
//   - Renderiza las fechas (YYYY-MM-DD) en los labels de cada día.
//   - El header incluye el eyebrow "Vista del día".

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TodayYesterdayCard } from "@/components/dashboard/today-yesterday-card";
import type { ActivityComparison } from "@/lib/cache";

const baseComparison: ActivityComparison = {
  today: {
    flights_count: 5,
    area_fumigated_m2: 12_500, // 1.25 ha
    parcels_touched: 3,
    duration_minutes: 95 // 1h 35m
  },
  yesterday: {
    flights_count: 8,
    area_fumigated_m2: 24_000, // 2.4 ha
    parcels_touched: 4,
    duration_minutes: 180 // 3h
  },
  dates: { today: "2026-07-23", yesterday: "2026-07-22" }
};

describe("<TodayYesterdayCard /> — F4.0 dashboard", () => {
  it("renderiza el eyebrow del card y los dos sub-panels", () => {
    render(<TodayYesterdayCard comparison={baseComparison} />);
    expect(screen.getByText(/Vista del día/i)).toBeInTheDocument();
    expect(screen.getByTestId("today-yesterday-yesterday")).toBeInTheDocument();
    expect(screen.getByTestId("today-yesterday-today")).toBeInTheDocument();
  });

  it("muestra los 4 metrics de hoy con los valores correctos", () => {
    render(<TodayYesterdayCard comparison={baseComparison} />);
    const today = screen.getByTestId("today-yesterday-today");
    expect(today).toHaveTextContent("5"); // flights
    expect(today).toHaveTextContent("1.25 ha"); // area
    expect(today).toHaveTextContent("3"); // parcels
    expect(today).toHaveTextContent("1h 35m"); // duration
  });

  it("muestra los 4 metrics de ayer con los valores correctos", () => {
    render(<TodayYesterdayCard comparison={baseComparison} />);
    const yesterday = screen.getByTestId("today-yesterday-yesterday");
    expect(yesterday).toHaveTextContent("8");
    expect(yesterday).toHaveTextContent("2.40 ha");
    expect(yesterday).toHaveTextContent("4");
    expect(yesterday).toHaveTextContent("3h");
  });

  it("incluye la fecha (YYYY-MM-DD) en el label de cada día", () => {
    render(<TodayYesterdayCard comparison={baseComparison} />);
    expect(screen.getByText(/2026-07-22/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-23/)).toBeInTheDocument();
  });

  it("muestra empty state inline cuando un día está en 0", () => {
    const emptyYesterday: ActivityComparison = {
      ...baseComparison,
      yesterday: {
        flights_count: 0,
        area_fumigated_m2: 0,
        parcels_touched: 0,
        duration_minutes: 0
      }
    };
    render(<TodayYesterdayCard comparison={emptyYesterday} />);
    expect(screen.getAllByText(/Sin actividad/i).length).toBeGreaterThanOrEqual(1);
  });

  it("muestra empty state en ambos días si los dos están en 0 (BD recién poblada)", () => {
    const allEmpty: ActivityComparison = {
      today: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
      yesterday: { flights_count: 0, area_fumigated_m2: 0, parcels_touched: 0, duration_minutes: 0 },
      dates: { today: "2026-07-23", yesterday: "2026-07-22" }
    };
    render(<TodayYesterdayCard comparison={allEmpty} />);
    expect(screen.getAllByText(/Sin actividad/i).length).toBe(2);
  });

  it("formatea duration < 60min como solo minutos (ej '45m')", () => {
    const shortDuration: ActivityComparison = {
      ...baseComparison,
      today: {
        flights_count: 2,
        area_fumigated_m2: 0,
        parcels_touched: 1,
        duration_minutes: 45
      }
    };
    render(<TodayYesterdayCard comparison={shortDuration} />);
    expect(screen.getByTestId("today-yesterday-today")).toHaveTextContent("45m");
  });

  it("formatea duration como solo horas cuando los minutos son 0 (ej '2h')", () => {
    const exactHours: ActivityComparison = {
      ...baseComparison,
      today: {
        flights_count: 2,
        area_fumigated_m2: 0,
        parcels_touched: 1,
        duration_minutes: 120
      }
    };
    render(<TodayYesterdayCard comparison={exactHours} />);
    expect(screen.getByTestId("today-yesterday-today")).toHaveTextContent("2h");
    expect(screen.getByTestId("today-yesterday-today")).not.toHaveTextContent("2h 0m");
  });
});
