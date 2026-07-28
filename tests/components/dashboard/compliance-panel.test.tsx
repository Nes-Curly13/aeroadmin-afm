// tests/components/dashboard/compliance-panel.test.tsx
//
// Cobertura del V0 port de CompliancePanel:
//   - data-slot="compliance-panel" presente.
//   - 4 cards de count por status, con label + count + % del portafolio.
//   - Stacked bar con role="img" y 4 segmentos proporcionales.
//   - Lista "Requieren atención" filtra overdue + no_history, top 6, orden por
//     days_until_next_due ascendente.
//   - Empty state cuando no hay parcelas que requieran atención.
//   - Mapping severity → CadenceStatus (helper exportado severityToCadenceStatus).
//   - Link a /parcels/[id] (ruta del proyecto, no /parcelas/ del V0).
//   - Cuando una parcela tiene land_name null, se usa external_id.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import {
  CompliancePanel,
  severityToCadenceStatus
} from "@/components/dashboard/compliance-panel";
import type { OverdueParcel } from "@/lib/types";

function makeParcel(over: Partial<OverdueParcel> = {}): OverdueParcel {
  return {
    parcel_id: 1,
    land_name: "Parcela 1",
    external_id: "ext-1",
    field_type: "Farmland",
    is_orchard: false,
    drone_model_name: "T40",
    crop_type: "Caña de azúcar",
    recommended_cadence_days: 14,
    last_fumigation_date: "2026-06-01",
    next_due_date: "2026-06-15",
    days_until_next_due: -3,
    severity: "overdue",
    area_fumigable_m2: 12_500,
    waypoint_count: 24,
    area_fumigable_ha: 1.25,
    ...over
  };
}

describe("severityToCadenceStatus", () => {
  it("mapea overdue → vencido", () => {
    expect(severityToCadenceStatus("overdue")).toBe("vencido");
  });
  it("mapea due_soon → por_vencer", () => {
    expect(severityToCadenceStatus("due_soon")).toBe("por_vencer");
  });
  it("mapea ok → al_dia", () => {
    expect(severityToCadenceStatus("ok")).toBe("al_dia");
  });
  it("mapea no_history → critico", () => {
    expect(severityToCadenceStatus("no_history")).toBe("critico");
  });
});

describe("<CompliancePanel />", () => {
  it("aplica data-slot='compliance-panel' al contenedor", () => {
    const { container } = render(<CompliancePanel summaries={[]} />);
    expect(container.querySelector('[data-slot="compliance-panel"]')).not.toBeNull();
  });

  it("con summaries vacíos: 0 en cada status, mensaje 'Todo el portafolio está al día'", () => {
    render(<CompliancePanel summaries={[]} />);
    // Counts en 0
    for (const s of ["vencido", "por_vencer", "al_dia", "critico"]) {
      expect(screen.getByTestId(`compliance-count-${s}`).textContent).toBe("0");
    }
    expect(screen.getByTestId("compliance-attention-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("compliance-attention")).toBeNull();
  });

  it("muestra los 4 cards de count con label y % del portafolio", () => {
    const summaries = [
      makeParcel({ parcel_id: 1, severity: "overdue" }),
      makeParcel({ parcel_id: 2, severity: "overdue" }),
      makeParcel({ parcel_id: 3, severity: "due_soon" }),
      makeParcel({ parcel_id: 4, severity: "ok" })
    ];
    render(<CompliancePanel summaries={summaries} />);
    // 2 vencidos, 1 por vencer, 0 críticos, 1 al día
    expect(screen.getByTestId("compliance-count-vencido").textContent).toBe("2");
    expect(screen.getByTestId("compliance-count-por_vencer").textContent).toBe("1");
    expect(screen.getByTestId("compliance-count-critico").textContent).toBe("0");
    expect(screen.getByTestId("compliance-count-al_dia").textContent).toBe("1");
    // % del portafolio (4 total → 2/4=50%, 1/4=25%, etc.)
    expect(screen.getByTestId("compliance-counts")).toHaveTextContent("50% del portafolio");
    expect(screen.getByTestId("compliance-counts")).toHaveTextContent("25% del portafolio");
  });

  it("renderiza el stacked bar con role='img' y 4 segmentos proporcionales al count", () => {
    const summaries = [
      makeParcel({ parcel_id: 1, severity: "overdue" }),
      makeParcel({ parcel_id: 2, severity: "overdue" }),
      makeParcel({ parcel_id: 3, severity: "overdue" }),
      makeParcel({ parcel_id: 4, severity: "due_soon" })
    ];
    const { container } = render(<CompliancePanel summaries={summaries} />);
    const bar = screen.getByTestId("compliance-stacked-bar");
    expect(bar.getAttribute("role")).toBe("img");
    // aria-label menciona el total
    expect(bar.getAttribute("aria-label")).toMatch(/4 parcelas/);
    // Vencido: 3/4 = 75% (width inline)
    const vencidoSeg = container.querySelector('[data-status="vencido"]') as HTMLElement;
    expect(vencidoSeg.style.width).toBe("75%");
    // Por vencer: 1/4 = 25%
    const porVencerSeg = container.querySelector('[data-status="por_vencer"]') as HTMLElement;
    expect(porVencerSeg.style.width).toBe("25%");
  });

  it("lista 'Requieren atención' filtra overdue + no_history, máximo 6", () => {
    const summaries = [
      // 7 overdue
      ...Array.from({ length: 7 }, (_, i) =>
        makeParcel({ parcel_id: 100 + i, severity: "overdue" })
      ),
      // 2 due_soon (NO deben aparecer)
      makeParcel({ parcel_id: 200, severity: "due_soon" }),
      makeParcel({ parcel_id: 201, severity: "due_soon" }),
      // 1 ok (NO debe aparecer)
      makeParcel({ parcel_id: 300, severity: "ok" }),
      // 3 no_history (SÍ deben aparecer — son los más críticos)
      ...Array.from({ length: 3 }, (_, i) =>
        makeParcel({ parcel_id: 400 + i, severity: "no_history" })
      )
    ];
    render(<CompliancePanel summaries={summaries} />);
    const list = screen.getByTestId("compliance-attention");
    // Esperado: 6 items (top 6 de los 7+3=10 elegibles, ordenados por days_until_next_due ASC).
    const items = within(list).getAllByRole("listitem");
    expect(items.length).toBe(6);
    // Las 2 due_soon NO aparecen
    expect(within(list).queryByTestId("compliance-link-200")).toBeNull();
    expect(within(list).queryByTestId("compliance-link-201")).toBeNull();
    // La ok tampoco
    expect(within(list).queryByTestId("compliance-link-300")).toBeNull();
  });

  it("la lista 'Requieren atención' ordena por days_until_next_due ASC (más atrasado primero)", () => {
    const summaries = [
      makeParcel({ parcel_id: 1, severity: "overdue", days_until_next_due: -1 }),
      makeParcel({ parcel_id: 2, severity: "overdue", days_until_next_due: -10 }),
      makeParcel({ parcel_id: 3, severity: "overdue", days_until_next_due: -3 })
    ];
    const { container } = render(<CompliancePanel summaries={summaries} />);
    const items = container.querySelectorAll(
      '[data-testid="compliance-attention"] > li'
    );
    // Esperado: [2 (-10), 3 (-3), 1 (-1)]
    expect(items[0].querySelector("a")?.getAttribute("href")).toBe("/parcels/2");
    expect(items[1].querySelector("a")?.getAttribute("href")).toBe("/parcels/3");
    expect(items[2].querySelector("a")?.getAttribute("href")).toBe("/parcels/1");
  });

  it("links apuntan a /parcels/[id] (ruta del proyecto, no /parcelas/ del V0)", () => {
    const summaries = [
      makeParcel({ parcel_id: 42, severity: "overdue" })
    ];
    render(<CompliancePanel summaries={summaries} />);
    const link = screen.getByTestId("compliance-link-42");
    expect(link.getAttribute("href")).toBe("/parcels/42");
  });

  it("muestra 'X d vencida' cuando days_until_next_due es negativo", () => {
    const summaries = [
      makeParcel({ parcel_id: 1, severity: "overdue", days_until_next_due: -7 })
    ];
    render(<CompliancePanel summaries={summaries} />);
    expect(screen.getByTestId("compliance-days-late-1").textContent).toBe("7 d vencida");
  });

  it("muestra 'Sin historial' cuando severity es no_history (days_until_next_due null)", () => {
    const summaries = [
      makeParcel({
        parcel_id: 1,
        severity: "no_history",
        days_until_next_due: null,
        last_fumigation_date: null
      })
    ];
    render(<CompliancePanel summaries={summaries} />);
    expect(screen.getByTestId("compliance-days-late-1").textContent).toBe(
      "Sin historial"
    );
  });

  it("usa external_id como label si land_name es null", () => {
    const summaries = [
      makeParcel({
        parcel_id: 1,
        land_name: null,
        external_id: "ext-99",
        severity: "overdue"
      })
    ];
    render(<CompliancePanel summaries={summaries} />);
    // El label ahora incluye "land_name · area_ha" en una sola línea.
    // Buscamos por texto parcial para que el test no rompa si cambia
    // el formato (ej: "ext-99 · 5.30 ha" o "ext-99").
    expect(screen.getByText(/ext-99/)).toBeInTheDocument();
  });

  it("oculta 'X.X ha ·' si area_fumigable_ha es null", () => {
    const summaries = [
      makeParcel({
        parcel_id: 1,
        severity: "overdue",
        area_fumigable_ha: null,
        area_fumigable_m2: null
      })
    ];
    const { container } = render(<CompliancePanel summaries={summaries} />);
    // El span con la metadata no debe contener " ha ·"
    const link = screen.getByTestId("compliance-link-1");
    expect(link.textContent).not.toMatch(/ ha ·/);
    // Pero sí menciona la cadencia
    expect(link.textContent).toMatch(/cadencia 14 d/);
  });
});
