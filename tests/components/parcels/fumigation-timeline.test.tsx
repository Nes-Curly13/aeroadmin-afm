// tests/components/parcels/fumigation-timeline.test.tsx
//
// Tests del componente FumigationTimeline (Sprint v0.1 — port del V0).
// Cubre:
//   - Empty state cuando no hay fumigaciones.
//   - Render de cada fumigación con su header (fecha, source, gap).
//   - Chip "En ventana" / "Fuera de ventana" según tolerancia ±2 días.
//   - Linkage flights ↔ fumigaciones vía `flight_ids`.
//   - Ocultamiento de notes que son provenance JSON.
//   - Render de human_notes (separado de notes).
//   - Cálculo de drift vs cadencia.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { FumigationTimeline, type FlightEvent } from "@/components/parcels/fumigation-timeline";
import type { DjiFumigationEvent } from "@/lib/types";

// =====================================================================
// Fixture helpers
// =====================================================================

function makeEvent(over: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 1,
    parcel_id: 10,
    fumigation_date: "2026-07-15",
    product_used: "Glifosato 1L/ha",
    dose_l_per_ha: 1.0,
    area_fumigated_m2: 50_000,
    drone_code_used: null,
    duration_minutes: 30,
    notes: null,
    human_notes: null,
    recorded_by: "Juan Pérez",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-07-15T14:00:00Z",
    source: "manual",
    flight_ids: null,
    ...over
  };
}

function makeFlight(over: Partial<FlightEvent> = {}): FlightEvent {
  return {
    id: 100,
    date: "2026-07-15",
    droneNickname: "AFM T50-1",
    pilotName: "Carlos",
    areaHa: 5.0,
    durationSeconds: 1800,
    ...over
  };
}

// =====================================================================
// Tests
// =====================================================================

describe("FumigationTimeline", () => {
  it("empty state: mensaje claro cuando no hay fumigaciones", () => {
    render(<FumigationTimeline fumigations={[]} flights={[]} cadenceDays={14} />);
    const empty = screen.getByTestId("fumigation-timeline-empty");
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/sin fumigaciones/i);
    // El slot sigue presente incluso en empty state.
    const slot = screen.getByTestId("fumigation-timeline-empty");
    expect(slot.getAttribute("data-slot")).toBe("fumigation-timeline");
  });

  it("renderiza una <li> por fumigación con data-testid por id", () => {
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-07-06" })
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    expect(screen.getByTestId("fumigation-timeline-item-1")).toBeInTheDocument();
    expect(screen.getByTestId("fumigation-timeline-item-2")).toBeInTheDocument();
  });

  it("con una sola fumigación, no hay gap ni chip de ventana (no hay 'anterior')", () => {
    // Cuando hay 1 sola fumigación, no existe la "anterior" contra la que
    // comparar el gap. NO mostramos ni gap ni chip de ventana (sería ruido).
    const events = [makeEvent({ id: 1, fumigation_date: "2026-07-20" })];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    expect(screen.queryByTestId("fumigation-timeline-gap-1")).toBeNull();
    expect(screen.queryByTestId("fumigation-timeline-window-1")).toBeNull();
  });

  it("calcula el gap en días entre fumigaciones consecutivas (DESC order)", () => {
    // Fumigaciones pasadas en orden DESC: 2026-07-20, 2026-07-06.
    // El gap del item 1 (más reciente) respecto del 2 es 14 días.
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-07-06" })
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    const gapText = screen.getByTestId("fumigation-timeline-gap-1");
    expect(gapText.textContent).toMatch(/14 d desde la anterior/i);
  });

  it("chip 'En ventana' (verde) cuando gap <= cadencia + 2", () => {
    // Cadencia 14, gap 16 → 16 <= 14 + 2 = 16 → en ventana (límite inclusivo).
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-07-04" }) // gap = 16
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    const chip = screen.getByTestId("fumigation-timeline-window-1");
    expect(chip.textContent).toMatch(/en ventana/i);
    expect(chip.className).toMatch(/text-\[#0b5f2d\]/);
  });

  it("chip 'Fuera de ventana' (rojo) cuando gap > cadencia + 2", () => {
    // Cadencia 14, gap 20 → fuera de ventana.
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-06-30" }) // gap = 20
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    const chip = screen.getByTestId("fumigation-timeline-window-1");
    expect(chip.textContent).toMatch(/fuera de ventana/i);
    expect(chip.className).toMatch(/text-\[#a93232\]/);
  });

  it("muestra drift vs cadencia (positivo = atraso, negativo = adelanto)", () => {
    // Cadencia 14, gap 20 → drift = +6 (atraso, color rojo).
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-06-30" })
    ];
    const { rerender } = render(
      <FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />
    );
    const gap = screen.getByTestId("fumigation-timeline-gap-1");
    expect(gap.textContent).toMatch(/\+6 vs cadencia/);

    // Ahora gap menor que cadencia: drift -3 (adelanto, color verde).
    const events2 = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20" }),
      makeEvent({ id: 2, fumigation_date: "2026-07-09" }) // gap = 11
    ];
    rerender(<FumigationTimeline fumigations={events2} flights={[]} cadenceDays={14} />);
    const gap2 = screen.getByTestId("fumigation-timeline-gap-1");
    expect(gap2.textContent).toMatch(/-3 vs cadencia/);
  });

  it("chip de source con color por tipo (manual/import/djiscraper)", () => {
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20", source: "manual" }),
      makeEvent({ id: 2, fumigation_date: "2026-07-06", source: "import" }),
      makeEvent({ id: 3, fumigation_date: "2026-06-22", source: "djiscraper" })
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    const manualChip = screen.getByTestId("fumigation-timeline-source-1");
    expect(manualChip.textContent).toBe("Manual");
    expect(manualChip.className).toMatch(/text-\[#0b5f2d\]/);
    const importChip = screen.getByTestId("fumigation-timeline-source-2");
    expect(importChip.textContent).toBe("Import");
    const djiscraperChip = screen.getByTestId("fumigation-timeline-source-3");
    expect(djiscraperChip.textContent).toBe("DJI scraper");
  });

  it("linkage flights↔fumigación: filtra por `flight_ids`", () => {
    // Fumigación 1 con flight_ids=[100, 101]. Fumigación 2 con flight_ids=[].
    // Solo el vuelo 100 debe mostrarse como sortie de la fumigación 1.
    const events = [
      makeEvent({ id: 1, fumigation_date: "2026-07-20", flight_ids: [100, 101] }),
      makeEvent({ id: 2, fumigation_date: "2026-07-06", flight_ids: [] })
    ];
    const flights = [
      makeFlight({ id: 100, droneNickname: "AFM T50-1" }),
      makeFlight({ id: 101, droneNickname: "AFM T40-2" }),
      makeFlight({ id: 999, droneNickname: "NO MATCH" })
    ];
    render(<FumigationTimeline fumigations={events} flights={flights} cadenceDays={14} />);

    // Item 1 muestra sus 2 vuelos.
    const item1 = screen.getByTestId("fumigation-timeline-item-1");
    const sortie1 = within(item1).getByTestId("fumigation-timeline-sortie-1");
    expect(sortie1.textContent).toMatch(/AFM T50-1/);
    expect(sortie1.textContent).toMatch(/AFM T40-2/);
    expect(sortie1.textContent).not.toMatch(/NO MATCH/);

    // Item 2 sin vuelo (flight_ids vacío): no se renderiza el bloque sortie.
    expect(within(item1).queryByTestId("fumigation-timeline-sortie-2")).toBeNull();
  });

  it("flight_ids null → no muestra sortie (backwards compat con fumigaciones pre-G2)", () => {
    const events = [makeEvent({ id: 1, fumigation_date: "2026-07-20", flight_ids: null })];
    const flights = [makeFlight({ id: 100 })];
    render(<FumigationTimeline fumigations={events} flights={flights} cadenceDays={14} />);
    const item1 = screen.getByTestId("fumigation-timeline-item-1");
    expect(within(item1).queryByTestId("fumigation-timeline-sortie-1")).toBeNull();
  });

  it("oculta `notes` cuando es provenance JSON (backfill de DJI scraper)", () => {
    // El backfill mete metadata en `notes` como JSON. No se debe mostrar
    // al operador (ya está expuesto en otros campos del row).
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-20",
        notes: '{"drones":["AFM T50-1"], "backfilled_from":"dji_flights", "flights_count":1}'
      })
    ];
    const { container } = render(
      <FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />
    );
    expect(container.textContent).not.toMatch(/backfilled_from/);
    expect(container.textContent).not.toMatch(/drones/);
  });

  it("muestra `notes` cuando es nota libre (no provenance JSON)", () => {
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-20",
        notes: "Lluvia leve al inicio, secado en 20 min"
      })
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    expect(screen.getByText(/lluvia leve al inicio/i)).toBeInTheDocument();
  });

  it("muestra human_notes (separado de notes)", () => {
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-20",
        human_notes: "Equipo reportó problema X",
        notes: null
      })
    ];
    render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />);
    expect(screen.getByTestId("fumigation-timeline-human-notes-1")).toHaveTextContent(
      /equipo reportó problema x/i
    );
  });

  it("muestra producto + dosis + área en ha + vuelos + operador", () => {
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-20",
        product_used: "Glifosato",
        dose_l_per_ha: 1.5,
        area_fumigated_m2: 50_000, // = 5.00 ha
        recorded_by: "Juan Pérez",
        flight_ids: [100]
      })
    ];
    const flights = [makeFlight({ id: 100, droneNickname: "AFM T50-1" })];
    render(<FumigationTimeline fumigations={events} flights={flights} cadenceDays={14} />);
    const item = screen.getByTestId("fumigation-timeline-item-1");
    expect(item.textContent).toMatch(/Glifosato/);
    expect(item.textContent).toMatch(/1\.5 L\/ha/);
    expect(item.textContent).toMatch(/5\.00 ha/);
    expect(item.textContent).toMatch(/1 vuelo/);
    expect(item.textContent).toMatch(/Juan Pérez/);
  });

  it("tolera campos null/undefined sin romper", () => {
    const events = [
      makeEvent({
        id: 1,
        fumigation_date: "2026-07-20",
        product_used: null,
        dose_l_per_ha: null,
        area_fumigated_m2: null,
        recorded_by: null,
        flight_ids: null
      })
    ];
    expect(() =>
      render(<FumigationTimeline fumigations={events} flights={[]} cadenceDays={14} />)
    ).not.toThrow();
  });
});
