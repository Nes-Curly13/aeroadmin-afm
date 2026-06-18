import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { HistoryTable } from "@/components/history/history-table";
import type { DjiDailySummaryRecord } from "@/lib/types";

function makeFlight(over: Partial<DjiDailySummaryRecord>): DjiDailySummaryRecord {
  return {
    id: 1,
    record_date: "2026-06-01",
    weekday: "Monday",
    category: "Agriculture",
    area_mu: 10,
    times_count: 5,
    usage_liters: 50,
    work_time_text: "1Hour0min0s",
    raw_text: "raw",
    ...over
  };
}

const FLIGHTS: DjiDailySummaryRecord[] = [
  makeFlight({ id: 1, record_date: "2026-05-15", area_mu: 20, times_count: 10, usage_liters: 100 }),
  makeFlight({ id: 2, record_date: "2026-05-20", area_mu: 40, times_count: 25, usage_liters: 250 }),
  makeFlight({ id: 3, record_date: "2026-06-10", area_mu: 80, times_count: 50, usage_liters: 600 }),
  makeFlight({ id: 4, record_date: "2026-04-05", area_mu: 5, times_count: 3, usage_liters: 30, category: "Orchards" })
];

describe("HistoryTable", () => {
  it("renderiza las 6 columnas", () => {
    render(<HistoryTable flights={FLIGHTS} />);
    expect(screen.getByRole("columnheader", { name: /fecha/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /categoría|categoria/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /área|area/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /salidas/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /litros/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /tiempo/i })).toBeInTheDocument();
  });

  it("muestra estado vacío cuando no hay flights", () => {
    render(<HistoryTable flights={[]} />);
    expect(screen.getByText(/no hay resúmenes importados/i)).toBeInTheDocument();
  });

  describe("orden", () => {
    it("ordena por fecha asc al click en el header", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const dateHeader = screen.getByRole("columnheader", { name: /fecha/i });
      fireEvent.click(within(dateHeader).getByRole("button"));
      // Después de ordenar, aria-sort debe ser ascending
      expect(dateHeader).toHaveAttribute("aria-sort", "ascending");
    });

    it("cambia de asc a desc en el segundo click", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const dateHeader = screen.getByRole("columnheader", { name: /fecha/i });
      const button = within(dateHeader).getByRole("button");
      fireEvent.click(button);
      fireEvent.click(button);
      expect(dateHeader).toHaveAttribute("aria-sort", "descending");
    });

    it("ordena por área desc y muestra el mayor primero", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const areaHeader = screen.getByRole("columnheader", { name: /área|area/i });
      const button = within(areaHeader).getByRole("button");
      // 2 clicks = descending
      fireEvent.click(button);
      fireEvent.click(button);
      // El primer flight visible (mayor area_mu) debe ser el de 80
      const rows = screen.getAllByRole("row");
      // rows[0] es el header. rows[1] es el primer flight.
      expect(rows[1].textContent).toContain("80");
    });

    it("ordena por litros ascendente", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const litrosHeader = screen.getByRole("columnheader", { name: /litros/i });
      const button = within(litrosHeader).getByRole("button");
      fireEvent.click(button); // asc
      const rows = screen.getAllByRole("row");
      // el primer flight (menor litros=30) debería estar arriba
      expect(rows[1].textContent).toContain("Orchards");
    });
  });

  describe("filtro por categoría", () => {
    it("filtra a 'Orchards' cuando se selecciona", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "Orchards" } });
      // Solo 1 fila de Orchard
      const rows = screen.getAllByRole("row");
      // 1 header + 1 flight
      expect(rows.length).toBe(2);
    });

    it("'Todas' muestra todos los flights", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const select = screen.getByRole("combobox");
      fireEvent.change(select, { target: { value: "ALL" } });
      const rows = screen.getAllByRole("row");
      // 1 header + 4 flights
      expect(rows.length).toBe(5);
    });
  });

  describe("paginación", () => {
    it("página 1 con 4 flights (todos visibles, pageSize=20)", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      expect(screen.getByText(/página 1 de 1/i)).toBeInTheDocument();
    });

    it("con 25 flights muestra 20 y navegación a página 2", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        makeFlight({ id: i + 1, record_date: `2026-05-${(i + 1).toString().padStart(2, "0")}` })
      );
      render(<HistoryTable flights={many} />);
      expect(screen.getByText(/página 1 de 2/i)).toBeInTheDocument();
      const rows = screen.getAllByRole("row");
      // header + 20 flights
      expect(rows.length).toBe(21);
    });

    it("click en 'Siguiente' avanza a página 2", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        makeFlight({ id: i + 1, record_date: `2026-05-${(i + 1).toString().padStart(2, "0")}` })
      );
      render(<HistoryTable flights={many} />);
      const next = screen.getByRole("button", { name: /siguiente/i });
      fireEvent.click(next);
      expect(screen.getByText(/página 2 de 2/i)).toBeInTheDocument();
    });

    it("botón 'Anterior' está deshabilitado en página 1", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        makeFlight({ id: i + 1, record_date: `2026-05-${(i + 1).toString().padStart(2, "0")}` })
      );
      render(<HistoryTable flights={many} />);
      const prev = screen.getByRole("button", { name: /anterior/i });
      expect(prev).toBeDisabled();
    });
  });

  describe("accesibilidad", () => {
    it("los headers de columna tienen aria-sort", () => {
      render(<HistoryTable flights={FLIGHTS} />);
      const headers = screen.getAllByRole("columnheader");
      for (const header of headers) {
        expect(header).toHaveAttribute("aria-sort");
      }
    });
  });
});
