// tests/components/reports/reports-tabs.test.tsx
//
// Tests del componente de tabs.
//
// Sprint 2026-09-08 — refactor a 2 niveles (Fase 7):
//   - Antes (QA-14, 2026-09-06): 3 tabs (Resumen / Por hacienda / Detalle).
//   - Ahora (Fase 7): 2 tabs (Reporte operativo / Resumen por parcela).
//
// Cubre:
//   - Las 2 tabs existen con role="tab"
//   - El panel correcto se muestra según la tab activa
//   - aria-selected refleja la tab activa
//   - El panel tiene role="tabpanel" + aria-labelledby
//   - La descripción de la tab activa se muestra debajo
//   - Default: Reporte operativo

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsTabs } from "@/components/reports/reports-tabs";

describe("ReportsTabs (Fase 7 — 2 niveles)", () => {
  it("renderiza las 2 tabs con role=tab", () => {
    render(
      <ReportsTabs
        operativo={<div>OPERATIVO_CONTENT</div>}
        parcela={<div>PARCELA_CONTENT</div>}
      />
    );
    expect(screen.getByRole("tab", { name: /Reporte operativo/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Resumen por parcela/ })).toBeInTheDocument();
  });

  it("arranca con la tab 'Reporte operativo' activa", () => {
    render(
      <ReportsTabs
        operativo={<div>OPERATIVO_CONTENT</div>}
        parcela={<div>PARCELA_CONTENT</div>}
      />
    );
    expect(screen.getByRole("tab", { name: /Reporte operativo/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: /Resumen por parcela/ })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByText("OPERATIVO_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("PARCELA_CONTENT")).not.toBeInTheDocument();
  });

  it("click en 'Resumen por parcela' cambia el panel visible", async () => {
    const user = userEvent.setup();
    render(
      <ReportsTabs
        operativo={<div>OPERATIVO_CONTENT</div>}
        parcela={<div>PARCELA_CONTENT</div>}
      />
    );
    await user.click(screen.getByRole("tab", { name: /Resumen por parcela/ }));
    expect(screen.getByText("PARCELA_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("OPERATIVO_CONTENT")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Resumen por parcela/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("el panel visible tiene role=tabpanel y aria-labelledby", () => {
    render(
      <ReportsTabs
        operativo={<div>OPERATIVO_CONTENT</div>}
        parcela={<div>PARCELA_CONTENT</div>}
      />
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "reports-tab-panel-operativo");
    expect(panel).toHaveAttribute("aria-labelledby", "reports-tab-operativo");
  });

  it("muestra la descripción de la tab activa", async () => {
    const user = userEvent.setup();
    render(
      <ReportsTabs
        operativo={<div>OPERATIVO_CONTENT</div>}
        parcela={<div>PARCELA_CONTENT</div>}
      />
    );
    // Default: Reporte operativo
    expect(screen.getByTestId("reports-tab-description").textContent).toMatch(/fumigación/i);
    // Cambio a Resumen por parcela
    await user.click(screen.getByRole("tab", { name: /Resumen por parcela/ }));
    expect(screen.getByTestId("reports-tab-description").textContent).toMatch(/agregado/i);
  });
});
