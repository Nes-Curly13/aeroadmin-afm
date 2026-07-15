// tests/components/fumigations/parcel-timeline.test.tsx
//
// Tests para <ParcelTimeline> (M7 — roadmap).
// Server component que renderiza la timeline de fumigaciones de una parcela.
//
// Cubre (checklist §4.1 de docs/guia/02_TDD_AeroAdmin_AFM.md):
//   - Render con datos típicos (5 eventos)
//   - Render con datos vacíos (0 eventos)
//   - Render con datos extremos (1 evento, 100 eventos)
//   - Accesibilidad: role="list" + role="listitem", aria-labels descriptivos,
//     headings jerárquicos (h2 + h3), fecha con día de semana

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ParcelTimeline } from "@/components/fumigations/parcel-timeline";
import type { FumigationTimelineResult } from "@/lib/types";

function ev(over: Partial<FumigationTimelineResult["events"][number]>) {
  return {
    id: 1,
    date: "2026-03-15",
    month: "2026-03",
    productUsed: "Glifosato",
    doseLPerHa: 1.5,
    areaHa: 1.0,
    durationSeconds: 3600,
    durationDjiFormat: "1Hour00min00s",
    droneCode: 1,
    droneNickname: "T40-01",
    pilotName: "Juan Pérez",
    recordedBy: "operator",
    notes: null,
    source: "manual" as const,
    ...over
  };
}

function timelineFixture(over: Partial<FumigationTimelineResult> = {}): FumigationTimelineResult {
  return {
    events: [
      ev({ id: 1, date: "2026-01-10", month: "2026-01" }),
      ev({ id: 2, date: "2026-02-15", month: "2026-02", droneNickname: "T40-02" }),
      ev({ id: 3, date: "2026-03-15", month: "2026-03", areaHa: 1.5, durationDjiFormat: "1Hour30min00s" })
    ],
    summary: {
      count: 3,
      totalAreaHa: 3.5,
      totalDurationSeconds: 14400,
      byMonth: [
        { yyyymm: "2026-01", count: 1, areaHa: 1, durationSeconds: 3600 },
        { yyyymm: "2026-02", count: 1, areaHa: 1, durationSeconds: 3600 },
        { yyyymm: "2026-03", count: 1, areaHa: 1.5, durationSeconds: 5400 }
      ],
      observedCadenceDays: 32,
      expectedCadenceDays: 14,
      gaps: [{ from: "2026-02-15", to: "2026-03-15", days: 28 }]
    },
    ...over
  };
}

describe("<ParcelTimeline>", () => {
  // ============================================================
  // Típico
  // ============================================================
  it("renderiza summary (count, area total, cadencia) y lista de eventos", () => {
    const t = timelineFixture();
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    // Summary: count visible
    expect(screen.getByText(/3 fumigaciones/i)).toBeInTheDocument();
    // Summary: cadencia esperada + observada
    expect(screen.getByText(/14 días/i)).toBeInTheDocument();
    expect(screen.getByText(/32 días/i)).toBeInTheDocument();
    // 1 gap listado
    expect(screen.getByText(/2026-02-15/)).toBeInTheDocument();
    expect(screen.getByText(/2026-03-15/)).toBeInTheDocument();
    // Lista de eventos con role="list"
    const list = screen.getByRole("list", { name: /fumigaciones de la parcela/i });
    expect(list).toBeInTheDocument();
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
  });

  // ============================================================
  // Vacío
  // ============================================================
  it("estado vacío: mensaje claro + sugerencia de ampliar rango", () => {
    const t = timelineFixture({
      events: [],
      summary: {
        count: 0,
        totalAreaHa: 0,
        totalDurationSeconds: 0,
        byMonth: [],
        observedCadenceDays: null,
        expectedCadenceDays: 14,
        gaps: []
      }
    });
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    expect(screen.getByText(/sin fumigaciones en este rango/i)).toBeInTheDocument();
    // Sugerencia: ampliar rango
    expect(screen.getByText(/ampliar el rango/i)).toBeInTheDocument();
  });

  it("estado vacío: el count en summary muestra 0 fumigaciones", () => {
    const t = timelineFixture({
      events: [],
      summary: {
        count: 0,
        totalAreaHa: 0,
        totalDurationSeconds: 0,
        byMonth: [],
        observedCadenceDays: null,
        expectedCadenceDays: null,
        gaps: []
      }
    });
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    expect(screen.getByText(/0 fumigaciones/i)).toBeInTheDocument();
  });

  // ============================================================
  // Extremo
  // ============================================================
  it("1 evento: cadencia observada es null (no computable con < 2 puntos)", () => {
    const t = timelineFixture({
      events: [ev({ id: 1, date: "2026-03-15", month: "2026-03" })],
      summary: {
        count: 1,
        totalAreaHa: 1.0,
        totalDurationSeconds: 3600,
        byMonth: [{ yyyymm: "2026-03", count: 1, areaHa: 1.0, durationSeconds: 3600 }],
        observedCadenceDays: null,
        expectedCadenceDays: 14,
        gaps: []
      }
    });
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    expect(screen.getByText(/1 fumigación/i)).toBeInTheDocument();
    // No gap (count < 2)
    const list = screen.getByRole("list", { name: /fumigaciones de la parcela/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("100 eventos: renderiza todos los items (extremo)", () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      ev({ id: i + 1, date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, month: "2026-01" })
    );
    const t = timelineFixture({
      events,
      summary: {
        count: 100,
        totalAreaHa: 100,
        totalDurationSeconds: 360_000,
        byMonth: [{ yyyymm: "2026-01", count: 100, areaHa: 100, durationSeconds: 360_000 }],
        observedCadenceDays: 0,
        expectedCadenceDays: 14,
        gaps: []
      }
    });
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    const list = screen.getByRole("list", { name: /fumigaciones de la parcela/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(100);
  });

  // ============================================================
  // A11y
  // ============================================================
  it("a11y: headings jerárquicos (h2 para secciones, h3 para meses)", () => {
    const t = timelineFixture();
    const { container } = render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    // h2: "Resumen" o equivalente
    const h2s = container.querySelectorAll("h2");
    expect(h2s.length).toBeGreaterThanOrEqual(1);

    // h3: cada mes en byMonth
    const h3s = container.querySelectorAll("h3");
    // 3 meses en el fixture
    expect(h3s.length).toBeGreaterThanOrEqual(3);
  });

  it("a11y: cada evento tiene aria-label descriptivo", () => {
    const t = timelineFixture();
    render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    const list = screen.getByRole("list", { name: /fumigaciones de la parcela/i });
    const items = within(list).getAllByRole("listitem");
    items.forEach((item) => {
      const label = item.getAttribute("aria-label");
      expect(label).toBeTruthy();
      // Aria-label debe incluir la fecha o algo identificable
      expect(label).toMatch(/2026/);
    });
  });

  it("a11y: la fecha del evento muestra día de semana (formato DJI/operador)", () => {
    // Domingo = 2026-03-15 (verificado). El test verifica que el label
    // incluye el día de la semana en formato texto, no solo el número.
    const t = timelineFixture({
      events: [ev({ id: 1, date: "2026-03-15", month: "2026-03" })],
      summary: {
        count: 1,
        totalAreaHa: 1.0,
        totalDurationSeconds: 3600,
        byMonth: [{ yyyymm: "2026-03", count: 1, areaHa: 1.0, durationSeconds: 3600 }],
        observedCadenceDays: null,
        expectedCadenceDays: 14,
        gaps: []
      }
    });
    const { container } = render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    // El texto visible debe incluir el día de semana en español (dom/lun/mié/etc.)
    const text = container.textContent ?? "";
    expect(text).toMatch(/dom|lun|mar|mié|jue|vie|sáb/);
  });

  it("a11y: métricas con unidad explícita (ej. 'ha' para área, no número solo)", () => {
    const t = timelineFixture();
    const { container } = render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    const text = container.textContent ?? "";
    // 'ha' debe aparecer como unidad
    expect(text).toMatch(/ha/);
  });

  // ============================================================
  // Sin schedule (parcela nueva)
  // ============================================================
  it("parcela sin schedule: muestra cadencia esperada como 'No definida' (no rompe)", () => {
    const t = timelineFixture({
      summary: {
        ...timelineFixture().summary,
        expectedCadenceDays: null
      }
    });
    const { container } = render(<ParcelTimeline parcelName="Parcela Test" timeline={t} />);

    expect(container.textContent).toMatch(/no definida/i);
  });
});
