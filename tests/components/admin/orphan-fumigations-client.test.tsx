// Tests para el client component orphan-fumigations-client.tsx
//
// Sprint H2 — agrega cobertura para las 3 columnas de metadata del
// scraper DJI (sortieCount, sprayUsageMl, workTimeHours) que se
// parsean del `notes` JSON de las fumigaciones huérfanas.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// Mockeamos next/navigation (router + refresh) para que el client
// component renderice sin reventar en jsdom.
const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerMocks.push,
    replace: vi.fn(),
    refresh: routerMocks.refresh,
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/admin/orphan-fumigations",
  useSearchParams: () => new URLSearchParams()
}));

import { OrphanFumigationsClient } from "@/app/admin/orphan-fumigations/orphan-fumigations-client";
import type { DjiFumigationEvent } from "@/lib/types";

const baseDbStats = {
  total: 30,
  orphan: 2,
  manual: 0,
  import: 30,
  djiscraper: 30,
  parcelasConFumigacion: 479,
  totalParcelas: 1206,
  coberturaPct: 39.7
};

const baseParcelOptions = [
  { id: 1, label: "1 — El Clavel" },
  { id: 2, label: "2 — La Esperanza" }
];

function makeRow(overrides: Partial<DjiFumigationEvent> = {}): DjiFumigationEvent {
  return {
    id: 610,
    parcel_id: null,
    fumigation_date: "2026-07-02",
    product_used: null,
    dose_l_per_ha: 103.06,
    area_fumigated_m2: 107882,
    drone_code_used: null,
    duration_minutes: 505453,
    notes: JSON.stringify({
      source: "djiscraper-aggr-by-day",
      sortieCount: 103,
      sprayUsageMl: 1111792,
      workTimeSec: 30327194
    }),
    human_notes: null,
    recorded_by: "djiag-import",
    product_registered_ica: null,
    pilot_license: null,
    recorded_at: "2026-07-03T14:19:19.854Z",
    source: "import",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OrphanFumigationsClient — metadata del scraper (Sprint H2)", () => {
  it("renderiza los 3 headers nuevos: Salidas, Aspersión, Horas", () => {
    const row = makeRow();
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={[row]}
        parcelOptions={baseParcelOptions}
        total={1}
        totalPages={1}
      />
    );
    const table = screen.getByTestId("orphan-fumigations-table");
    const headers = within(table).getAllByRole("columnheader");
    const headerTexts = headers.map((h) => h.textContent ?? "");
    expect(headerTexts).toContain("Salidas");
    expect(headerTexts).toContain("Aspersión (mL)");
    expect(headerTexts).toContain("Horas");
  });

  it("muestra los valores parseados de notes (sortieCount, sprayUsageMl, workTimeHours)", () => {
    const row = makeRow();
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={[row]}
        parcelOptions={baseParcelOptions}
        total={1}
        totalPages={1}
      />
    );
    expect(screen.getByTestId("orphan-fumigations-sortie-count")).toHaveTextContent("103");
    expect(screen.getByTestId("orphan-fumigations-spray-ml")).toHaveTextContent("1.111.792");
    expect(screen.getByTestId("orphan-fumigations-work-hours")).toHaveTextContent("8424.2");
  });

  it("muestra '—' cuando notes NO es del formato djiscraper-aggr-by-day", () => {
    const row = makeRow({
      notes: JSON.stringify({
        source: "import",
        backfilled_from: "dji_flights",
        flights_count: 12
      })
    });
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={[row]}
        parcelOptions={baseParcelOptions}
        total={1}
        totalPages={1}
      />
    );
    // El componente renderiza 3 guiones por cada fila no-scraper.
    // Buscamos dentro de la fila específica.
    const tr = screen.getByTestId("orphan-fumigations-row");
    const dashCells = within(tr).getAllByText("—");
    // 1 dash por "Producto" (no registrado) + 3 dashes por metadata
    // faltante (sortieCount, sprayUsageMl, workTimeHours).
    expect(dashCells.length).toBeGreaterThanOrEqual(3);
  });

  it("muestra '—' cuando notes es null", () => {
    const row = makeRow({ notes: null });
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={[row]}
        parcelOptions={baseParcelOptions}
        total={1}
        totalPages={1}
      />
    );
    const tr = screen.getByTestId("orphan-fumigations-row");
    const dashCells = within(tr).getAllByText("—");
    expect(dashCells.length).toBeGreaterThanOrEqual(3);
  });

  it("muestra '—' cuando notes es string no-JSON", () => {
    const row = makeRow({ notes: "not json at all" });
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={[row]}
        parcelOptions={baseParcelOptions}
        total={1}
        totalPages={1}
      />
    );
    const tr = screen.getByTestId("orphan-fumigations-row");
    const dashCells = within(tr).getAllByText("—");
    expect(dashCells.length).toBeGreaterThanOrEqual(3);
  });

  it("renderiza múltiples filas con metadata distinta", () => {
    const rows = [
      makeRow({ id: 610, notes: JSON.stringify({ source: "djiscraper-aggr-by-day", sortieCount: 103, sprayUsageMl: 1111792, workTimeSec: 30327194 }) }),
      makeRow({ id: 611, notes: JSON.stringify({ source: "djiscraper-aggr-by-day", sortieCount: 73, sprayUsageMl: 934384, workTimeSec: 25390593 }) })
    ];
    render(
      <OrphanFumigationsClient
        dbStats={baseDbStats}
        initialPage={1}
        initialRows={rows}
        parcelOptions={baseParcelOptions}
        total={2}
        totalPages={1}
      />
    );
    // Hay 2 filas, 2 spans de sortie-count, 2 de spray-ml, 2 de work-hours.
    expect(screen.getAllByTestId("orphan-fumigations-sortie-count")).toHaveLength(2);
    expect(screen.getAllByTestId("orphan-fumigations-spray-ml")).toHaveLength(2);
    expect(screen.getAllByTestId("orphan-fumigations-work-hours")).toHaveLength(2);
    expect(screen.getAllByTestId("orphan-fumigations-sortie-count")[0]).toHaveTextContent("103");
    expect(screen.getAllByTestId("orphan-fumigations-sortie-count")[1]).toHaveTextContent("73");
  });
});
