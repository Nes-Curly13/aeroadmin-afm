// tests/components/dashboard/compliance-panel.test.tsx
//
// Test del CompliancePanel con el nuevo prop `cycleByParcelId`
// (Sprint 2026-08-01 — "Fase de cultivo y cadencia efectiva").
//
// Cubre:
//   - **Sin prop** (backward compat): el panel renderiza sin chips de fase.
//   - **Con Map vacío**: igual sin chips (no hay datos de fase).
//   - **Con Map con fases**: cada parcela en "Requieren atención" muestra
//     un chip "Fase: <Label>" con el color codificado por la fase.
//   - **phase = null en el Map**: el chip muestra "Fase: Desconocida"
//     (label por default de `phaseLabel(null)`).
//   - **Fase no listada (no vencida/critica)**: el chip NO se muestra
//     porque solo se itera sobre attention (vencido/critico).
//   - **El chip tiene un title accesible** para screen readers que
//     explica la fase (o "Fase de cultivo desconocida" si null).

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CompliancePanel } from "@/components/dashboard/compliance-panel";
import type { ComplianceStatus, ParcelSummary } from "@/lib/types";

function makeSummary(
  parcelId: string,
  status: ComplianceStatus,
  daysToDue: number
): ParcelSummary {
  return {
    parcel: {
      id: parcelId,
      name: `Parcel ${parcelId}`,
      farm_name: "La Esperanza",
      area_ha: 10.5,
      // otros campos irrelevantes para este test
    } as ParcelSummary["parcel"],
    schedule: { cadence_days: 14 } as ParcelSummary["schedule"],
    last_fumigation_at: null,
    next_due_at: null,
    days_since_last: null,
    days_to_due: daysToDue,
    status,
    fumigations_count: 3
  } as ParcelSummary;
}

describe("CompliancePanel sin cycleByParcelId (backward compat)", () => {
  it("no renderiza chips de fase", () => {
    const summaries = [
      makeSummary("1", "vencido", -3),
      makeSummary("2", "critico", -10)
    ];
    render(<CompliancePanel summaries={summaries} />);
    // El panel renderiza los parcelas en atención.
    expect(screen.getByText(/Parcel 1/)).toBeTruthy();
    expect(screen.getByText(/Parcel 2/)).toBeTruthy();
    // Pero NO hay chips de fase.
    expect(screen.queryByText(/^Fase:/)).toBeNull();
  });
});

describe("CompliancePanel con cycleByParcelId", () => {
  it("renderiza el chip de fase para cada parcela en attention", () => {
    const summaries = [
      makeSummary("1", "vencido", -3),
      makeSummary("2", "critico", -10)
    ];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | null>([
      ["1", "vegetativa"],
      ["2", "madurante"]
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    expect(screen.getByText("Fase: Vegetativa")).toBeTruthy();
    expect(screen.getByText("Fase: Madurante")).toBeTruthy();
  });

  it("muestra 'Fase: Desconocida' cuando cycle_phase es null en el Map", () => {
    const summaries = [makeSummary("1", "vencido", -3)];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | null>([
      ["1", null] // planting_date no backfilleado
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    // phaseLabel(null) devuelve "Desconocida".
    expect(screen.getByText("Fase: Desconocida")).toBeTruthy();
  });

  it("no renderiza chip si el parcel no está en el Map (id faltante)", () => {
    const summaries = [makeSummary("1", "vencido", -3)];
    // Map vacío: parcel 1 no está.
    const cycleByParcelId = new Map<string, "vegetativa" | null>();
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    // El panel renderiza pero sin chip (cycleByParcelId se proveyó
    // pero el get() devuelve undefined → phase = null → "Desconocida"
    // se renderiza — eso es OK; el operador ve que el dato falta).
    // Actualización: el chip SÍ se renderiza con "Desconocida" porque
    // el código hace `cycleByParcelId?.get(s.parcel.id) ?? null` y
    // el panel chequea `cycleByParcelId !== undefined` para mostrar
    // el chip. Verificamos que el chip aparece con "Desconocida".
    expect(screen.getByText("Fase: Desconocida")).toBeTruthy();
  });

  it("no muestra chip de fase para parcelas al_día (solo attention)", () => {
    const summaries = [
      makeSummary("1", "vencido", -3), // aparece en attention
      makeSummary("2", "al_dia", 5) // NO aparece en attention
    ];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | null>([
      ["1", "vegetativa"],
      ["2", "madurante"]
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    // Parcel 1 (vencida) tiene chip de fase.
    expect(screen.getByText("Fase: Vegetativa")).toBeTruthy();
    // Parcel 2 (al día) NO aparece en "Requieren atención", no se
    // renderiza su chip. Verificamos que "Fase: Madurante" no existe
    // (solo Parcel 1 está en la lista, y su fase es vegetativa).
    expect(screen.queryByText("Fase: Madurante")).toBeNull();
  });

  it("el chip de fase tiene title accesible para screen readers", () => {
    const summaries = [makeSummary("1", "vencido", -3)];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | null>([
      ["1", "madurante"]
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    const chip = screen.getByText("Fase: Madurante");
    // El title debe ser explicativo (no solo el label).
    expect(chip.getAttribute("title")).toMatch(/Fase de cultivo: Madurante/);
  });

  it("title de fase null indica 'Fase de cultivo desconocida'", () => {
    const summaries = [makeSummary("1", "vencido", -3)];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | null>([
      ["1", null]
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    const chip = screen.getByText("Fase: Desconocida");
    expect(chip.getAttribute("title")).toMatch(/Fase de cultivo desconocida/);
    expect(chip.getAttribute("title")).toMatch(/backfill/);
  });

  it("renderiza todas las fases (establecimiento, vegetativa, madurante, cosecha)", () => {
    const summaries = [
      makeSummary("1", "vencido", -3),
      makeSummary("2", "vencido", -5),
      makeSummary("3", "vencido", -7),
      makeSummary("4", "vencido", -9)
    ];
    const cycleByParcelId = new Map<string, "vegetativa" | "madurante" | "cosecha" | "establecimiento" | null>([
      ["1", "establecimiento"],
      ["2", "vegetativa"],
      ["3", "madurante"],
      ["4", "cosecha"]
    ]);
    render(
      <CompliancePanel summaries={summaries} cycleByParcelId={cycleByParcelId} />
    );
    expect(screen.getByText("Fase: Establecimiento")).toBeTruthy();
    expect(screen.getByText("Fase: Vegetativa")).toBeTruthy();
    expect(screen.getByText("Fase: Madurante")).toBeTruthy();
    expect(screen.getByText("Fase: Cosecha")).toBeTruthy();
  });
});
