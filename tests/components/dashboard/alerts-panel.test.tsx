import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type { DjiAlertRecord } from "@/lib/types";

const ALERT_LOW: DjiAlertRecord = {
  parcel_id: 1,
  parcel_name: "Parcela A",
  level: "LOW",
  age_days: 5,
  message: "Operación normal",
  geometry: null
};

const ALERT_HIGH: DjiAlertRecord = {
  parcel_id: 2,
  parcel_name: "Parcela B",
  level: "HIGH",
  age_days: 30,
  message: "Riesgo alto de plaga",
  geometry: null
};

const ALERT_MEDIUM: DjiAlertRecord = {
  parcel_id: 3,
  parcel_name: "Parcela C",
  level: "MEDIUM",
  age_days: 15,
  message: "Volumen medio",
  geometry: null
};

describe("AlertsPanel", () => {
  it("renderiza el header 'Alertas DJI'", () => {
    render(<AlertsPanel alertFilter="ALL" alerts={[ALERT_LOW]} onAlertFilterChange={() => {}} />);
    expect(screen.getByRole("heading", { name: /alertas dji/i })).toBeInTheDocument();
  });

  it("renderiza los 4 botones de filtro (ALL/HIGH/MEDIUM/LOW)", () => {
    render(<AlertsPanel alertFilter="ALL" alerts={[]} onAlertFilterChange={() => {}} />);
    const buttons = screen.getAllByRole("button");
    const labels = buttons.map((b) => b.textContent?.trim().toUpperCase());
    expect(labels).toContain("ALL");
    expect(labels).toContain("HIGH");
    expect(labels).toContain("MEDIUM");
    expect(labels).toContain("LOW");
  });

  it("muestra todas las alertas con filtro ALL", () => {
    render(
      <AlertsPanel
        alertFilter="ALL"
        alerts={[ALERT_LOW, ALERT_HIGH, ALERT_MEDIUM]}
        onAlertFilterChange={() => {}}
      />
    );
    expect(screen.getByText("Parcela A")).toBeInTheDocument();
    expect(screen.getByText("Parcela B")).toBeInTheDocument();
    expect(screen.getByText("Parcela C")).toBeInTheDocument();
  });

  it("filtra a HIGH al hacer click en el botón HIGH", () => {
    const onChange = vi.fn();
    render(
      <AlertsPanel
        alertFilter="ALL"
        alerts={[ALERT_LOW, ALERT_HIGH, ALERT_MEDIUM]}
        onAlertFilterChange={onChange}
      />
    );
    const highButton = screen.getByRole("button", { name: "HIGH" });
    fireEvent.click(highButton);
    expect(onChange).toHaveBeenCalledWith("HIGH");
  });

  it("filtra a MEDIUM al hacer click en el botón MEDIUM", () => {
    const onChange = vi.fn();
    render(
      <AlertsPanel
        alertFilter="ALL"
        alerts={[ALERT_LOW, ALERT_HIGH, ALERT_MEDIUM]}
        onAlertFilterChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "MEDIUM" }));
    expect(onChange).toHaveBeenCalledWith("MEDIUM");
  });

  it("filtra a LOW al hacer click en el botón LOW", () => {
    const onChange = vi.fn();
    render(
      <AlertsPanel
        alertFilter="ALL"
        alerts={[ALERT_LOW, ALERT_HIGH, ALERT_MEDIUM]}
        onAlertFilterChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "LOW" }));
    expect(onChange).toHaveBeenCalledWith("LOW");
  });

  it("filtra a ALL al hacer click en el botón ALL", () => {
    const onChange = vi.fn();
    render(
      <AlertsPanel
        alertFilter="HIGH"
        alerts={[ALERT_LOW, ALERT_HIGH, ALERT_MEDIUM]}
        onAlertFilterChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    expect(onChange).toHaveBeenCalledWith("ALL");
  });

  it("muestra mensaje de estado vacío cuando no hay alertas", () => {
    render(<AlertsPanel alertFilter="ALL" alerts={[]} onAlertFilterChange={() => {}} />);
    expect(screen.getByText(/no hay alertas/i)).toBeInTheDocument();
  });

  it("muestra mensaje de filtro sin resultados", () => {
    render(
      <AlertsPanel alertFilter="HIGH" alerts={[ALERT_LOW]} onAlertFilterChange={() => {}} />
    );
    expect(screen.getByText(/no hay alertas para el filtro/i)).toBeInTheDocument();
  });

  it("el botón activo refleja el alertFilter actual con estilo distinto", () => {
    render(
      <AlertsPanel
        alertFilter="HIGH"
        alerts={[ALERT_LOW, ALERT_HIGH]}
        onAlertFilterChange={() => {}}
      />
    );
    const highButton = screen.getByRole("button", { name: "HIGH" });
    const allButton = screen.getByRole("button", { name: "ALL" });
    expect(highButton.className).toContain("bg-[#0b5f2d]");
    expect(allButton.className).not.toContain("bg-[#0b5f2d]");
  });

  it("muestra el mensaje y level de cada alerta", () => {
    render(
      <AlertsPanel
        alertFilter="ALL"
        alerts={[ALERT_HIGH]}
        onAlertFilterChange={() => {}}
      />
    );
    // El mensaje se renderiza como texto
    expect(screen.getByText("Riesgo alto de plaga")).toBeInTheDocument();
    // El nombre de la parcela
    expect(screen.getByText("Parcela B")).toBeInTheDocument();
    // El badge con el level "HIGH" está dentro de la alerta (usamos un selector CSS)
    const badge = document.querySelector('span.uppercase.tracking-wide');
    expect(badge?.textContent).toBe("HIGH");
  });
});
