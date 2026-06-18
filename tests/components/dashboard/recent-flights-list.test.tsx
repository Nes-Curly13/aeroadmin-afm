import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { RecentFlightsList } from "@/components/dashboard/recent-flights-list";
import type { DjiDailySummaryRecord } from "@/lib/types";

const FLIGHT_LOW: DjiDailySummaryRecord = {
  id: 1,
  record_date: "2026-06-01",
  weekday: "Monday",
  category: "Agriculture",
  area_mu: 10,
  times_count: 5,
  usage_liters: 50,
  work_time_text: "1Hour0min0s",
  raw_text: "raw"
};

const FLIGHT_HIGH: DjiDailySummaryRecord = {
  ...FLIGHT_LOW,
  id: 2,
  record_date: "2026-06-02",
  area_mu: 80,
  times_count: 90
};

const FLIGHT_MEDIUM: DjiDailySummaryRecord = {
  ...FLIGHT_LOW,
  id: 3,
  record_date: "2026-06-03",
  area_mu: 40,
  times_count: 50
};

describe("RecentFlightsList", () => {
  describe("render", () => {
    it("renderiza la lista de flights", () => {
      render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[FLIGHT_LOW, FLIGHT_HIGH]}
          onAlertFilterChange={() => {}}
        />
      );
      // usa flight.id en lugar de la fecha formateada (formatDate la cambia a "Jun 1, 2026")
      const items = document.querySelectorAll('[data-flight-id]');
      expect(items.length).toBe(2);
    });

    it("muestra estado vacío cuando flights está vacío", () => {
      render(<RecentFlightsList alertFilter="ALL" flights={[]} onAlertFilterChange={() => {}} />);
      expect(screen.getByText(/no hay vuelos/i)).toBeInTheDocument();
    });
  });

  describe("filtro", () => {
    it("ALL muestra todos los flights", () => {
      render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[FLIGHT_LOW, FLIGHT_HIGH, FLIGHT_MEDIUM]}
          onAlertFilterChange={() => {}}
        />
      );
      const items = document.querySelectorAll('[data-flight-id]');
      expect(items.length).toBe(3);
    });

    it("HIGH filtra a flights con area>=60 o times>=80", () => {
      render(
        <RecentFlightsList
          alertFilter="HIGH"
          flights={[FLIGHT_LOW, FLIGHT_HIGH, FLIGHT_MEDIUM]}
          onAlertFilterChange={() => {}}
        />
      );
      const items = document.querySelectorAll('[data-flight-id]');
      expect(items.length).toBe(1);
    });

    it("MEDIUM filtra a flights con area 30-59 o times 40-79", () => {
      render(
        <RecentFlightsList
          alertFilter="MEDIUM"
          flights={[FLIGHT_LOW, FLIGHT_HIGH, FLIGHT_MEDIUM]}
          onAlertFilterChange={() => {}}
        />
      );
      const items = document.querySelectorAll('[data-flight-id]');
      expect(items.length).toBe(1);
    });

    it("LOW filtra a flights con area<30 y times<40", () => {
      render(
        <RecentFlightsList
          alertFilter="LOW"
          flights={[FLIGHT_LOW, FLIGHT_HIGH, FLIGHT_MEDIUM]}
          onAlertFilterChange={() => {}}
        />
      );
      const items = document.querySelectorAll('[data-flight-id]');
      expect(items.length).toBe(1);
    });

    it("invoca onAlertFilterChange al cambiar el select", () => {
      const onChange = vi.fn();
      render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[FLIGHT_LOW]}
          onAlertFilterChange={onChange}
        />
      );
      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "HIGH" } });
      expect(onChange).toHaveBeenCalledWith("HIGH");
    });
  });

  describe("CSV export", () => {
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let originalRevokeObjectURL: typeof URL.revokeObjectURL;
    let blob: Blob | null;

    beforeEach(() => {
      blob = null;
      originalCreateObjectURL = URL.createObjectURL;
      originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn((b: Blob) => {
        blob = b;
        return "blob:test";
      });
      URL.revokeObjectURL = vi.fn();
      // stub anchor click
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        // noop
        return undefined;
      });
    });

    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
    });

    it("genera un Blob con los headers correctos", async () => {
      render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[FLIGHT_LOW, FLIGHT_HIGH]}
          onAlertFilterChange={() => {}}
        />
      );
      const exportButton = screen.getByRole("button", { name: /exportar csv/i });
      fireEvent.click(exportButton);

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(blob).not.toBeNull();
      const text = await (blob as unknown as Blob).text();
      expect(text).toContain("ID");
      expect(text).toContain("Fecha");
      expect(text).toContain("Categoria");
      expect(text).toContain("Area (mu)");
    });

    it("escapa comillas dobles en el CSV", async () => {
      const flightWithQuotes: DjiDailySummaryRecord = {
        ...FLIGHT_LOW,
        category: 'Agriculture "premium"'
      };
      render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[flightWithQuotes]}
          onAlertFilterChange={() => {}}
        />
      );
      const exportButton = screen.getByRole("button", { name: /exportar csv/i });
      fireEvent.click(exportButton);

      const text = await (blob as unknown as Blob).text();
      expect(text).toContain('"Agriculture ""premium"""');
    });
  });

  describe("accesibilidad", () => {
    it("el select tiene label accesible o está asociado al texto", () => {
      const { container } = render(
        <RecentFlightsList
          alertFilter="ALL"
          flights={[FLIGHT_LOW]}
          onAlertFilterChange={() => {}}
        />
      );
      // El select debe ser accesible por role
      const select = screen.getByRole("combobox");
      expect(select).toBeInTheDocument();
      // El contenedor tiene el header "Registro reciente"
      const header = within(container).getByText(/registro reciente/i);
      expect(header).toBeInTheDocument();
    });
  });
});
