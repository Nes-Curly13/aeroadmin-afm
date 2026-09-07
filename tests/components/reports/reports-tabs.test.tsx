// tests/components/reports/reports-tabs.test.tsx
//
// Tests del componente de tabs (QA-14, fix/qa-14-reportes-tabs,
// 2026-09-06).
//
// Cubre:
//   - Las 3 tabs existen con role="tab"
//   - El panel correcto se muestra según la tab activa
//   - aria-selected refleja la tab activa
//   - El panel tiene role="tabpanel" + aria-labelledby
//   - La descripción de la tab activa se muestra debajo

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsTabs } from "@/components/reports/reports-tabs";

describe("ReportsTabs", () => {
  it("renderiza las 3 tabs con role=tab", () => {
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    expect(screen.getByRole("tab", { name: /Resumen/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Por hacienda/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Detalle/ })).toBeInTheDocument();
  });

  it("arranca con la tab Resumen activa", () => {
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    expect(screen.getByRole("tab", { name: /Resumen/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: /Por hacienda/ })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByText("RESUMEN_CONTENT")).toBeInTheDocument();
  });

  it("click en otra tab cambia el panel visible", async () => {
    const user = userEvent.setup();
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    await user.click(screen.getByRole("tab", { name: /Por hacienda/ }));
    expect(screen.getByText("PARCELAS_CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("RESUMEN_CONTENT")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Por hacienda/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("click en Detalle muestra el panel Detalle", async () => {
    const user = userEvent.setup();
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    await user.click(screen.getByRole("tab", { name: /Detalle/ }));
    expect(screen.getByText("DETALLE_CONTENT")).toBeInTheDocument();
  });

  it("el panel visible tiene role=tabpanel y aria-labelledby", () => {
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "reports-tab-panel-resumen");
    expect(panel).toHaveAttribute("aria-labelledby", "reports-tab-resumen");
  });

  it("muestra la descripción de la tab activa", async () => {
    const user = userEvent.setup();
    render(
      <ReportsTabs
        resumen={<div>RESUMEN_CONTENT</div>}
        parcelas={<div>PARCELAS_CONTENT</div>}
        detalle={<div>DETALLE_CONTENT</div>}
      />
    );
    // Default: Resumen
    expect(screen.getByTestId("reports-tab-description").textContent).toMatch(/KPIs/i);
    // Cambio a Por hacienda
    await user.click(screen.getByRole("tab", { name: /Por hacienda/ }));
    expect(screen.getByTestId("reports-tab-description").textContent).toMatch(/agregado/i);
  });
});
