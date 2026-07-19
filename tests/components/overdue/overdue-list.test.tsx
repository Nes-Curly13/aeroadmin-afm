// tests/components/overdue/overdue-list.test.tsx
//
// TDD para <OverdueList> (M3-M5 Q2).
// Cubre:
//   1. Render del summary: 4 chips con counts correctos.
//   2. Click en chip filtra la lista client-side.
//   3. Click en "Limpiar filtro" vuelve al set completo.
//   4. Lista vacía muestra empty state.
//   5. Cada fila linkea a /parcels/[id].
//   6. Cada fila muestra el chip de severidad correcto.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { OverdueList, type OverdueSummary } from "@/components/overdue/overdue-list";
import type { OverdueParcel } from "@/lib/types";

const SUMMARY: OverdueSummary = {
  total: 4,
  overdue: 2,
  due_soon: 1,
  ok: 1,
  no_history: 0,
  max_days_ahead: 14
};

function makeParcel(over: {
  parcel_id: number;
  land_name?: string | null;
  severity?: "overdue" | "due_soon" | "ok" | "no_history";
  days_until_next_due?: number | null;
  crop_type?: string;
  is_orchard?: boolean;
  area_fumigable_ha?: number | null;
  waypoint_count?: number | null;
  drone_model_name?: string | null;
  recommended_cadence_days?: number;
}): OverdueParcel {
  return {
    parcel_id: over.parcel_id,
    land_name: over.land_name ?? `Parcela #${over.parcel_id}`,
    external_id: `ext-${over.parcel_id}`,
    field_type: "Farmland",
    is_orchard: over.is_orchard ?? false,
    drone_model_name: over.drone_model_name ?? "Agras T40",
    crop_type: over.crop_type ?? "Caña",
    recommended_cadence_days: over.recommended_cadence_days ?? 30,
    last_fumigation_date: "2026-05-15",
    next_due_date: "2026-06-15",
    days_until_next_due: over.days_until_next_due ?? 0,
    severity: over.severity ?? "ok",
    area_fumigable_m2: over.area_fumigable_ha !== null ? (over.area_fumigable_ha ?? 0) * 10000 : null,
    waypoint_count: over.waypoint_count ?? 50,
    area_fumigable_ha: over.area_fumigable_ha ?? 5
  };
}

const PARCELS: OverdueParcel[] = [
  makeParcel({ parcel_id: 1, land_name: "Porvenir", severity: "overdue", days_until_next_due: -10 }),
  makeParcel({ parcel_id: 2, land_name: "Gertrudis", severity: "overdue", days_until_next_due: -3 }),
  makeParcel({ parcel_id: 3, land_name: "Lourdes", severity: "due_soon", days_until_next_due: 2 }),
  makeParcel({ parcel_id: 4, land_name: "San Juan", severity: "ok", days_until_next_due: 20 })
];

describe("OverdueList", () => {
  it("renderiza 4 chips de summary con los counts correctos", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    // Cada chip es un button con aria-label que incluye el count.
    expect(screen.getByRole("button", { name: /Vencidas: 2 parcelas/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vencen esta semana: 1 parcelas/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /En fecha: 1 parcelas/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sin historial: 0 parcelas/i })).toBeInTheDocument();
  });

  it("muestra el total de ha fumigables", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20.5}
      />
    );
    expect(screen.getByText(/20\.50 ha fumigables/i)).toBeInTheDocument();
  });

  it("muestra las 4 parcelas por defecto (sin filtro)", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    expect(screen.getByText("Porvenir")).toBeInTheDocument();
    expect(screen.getByText("Gertrudis")).toBeInTheDocument();
    expect(screen.getByText("Lourdes")).toBeInTheDocument();
    expect(screen.getByText("San Juan")).toBeInTheDocument();
  });

  it("click en chip 'Vencidas' filtra a solo las 2 overdue", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Vencidas: 2 parcelas/i }));
    // Las overdue se ven
    expect(screen.getByText("Porvenir")).toBeInTheDocument();
    expect(screen.getByText("Gertrudis")).toBeInTheDocument();
    // Las no-overdue NO se ven
    expect(screen.queryByText("Lourdes")).not.toBeInTheDocument();
    expect(screen.queryByText("San Juan")).not.toBeInTheDocument();
  });

  it("click en el mismo chip activo limpia el filtro", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    const chip = screen.getByRole("button", { name: /Vencidas: 2 parcelas/i });
    fireEvent.click(chip);
    // Filter activo: solo overdue
    expect(screen.queryByText("Lourdes")).not.toBeInTheDocument();
    // Click otra vez: limpia
    fireEvent.click(chip);
    expect(screen.getByText("Lourdes")).toBeInTheDocument();
    expect(screen.getByText("San Juan")).toBeInTheDocument();
  });

  it("botón 'Limpiar filtro' aparece solo cuando hay filtro activo", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    expect(screen.queryByRole("button", { name: /Limpiar filtro/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Vencidas: 2 parcelas/i }));
    expect(screen.getByRole("button", { name: /Limpiar filtro/i })).toBeInTheDocument();
  });

  it("muestra empty state cuando no hay parcelas que matcheen", () => {
    render(
      <OverdueList
        parcels={[]}
        summary={{ ...SUMMARY, total: 0 }}
        totalHa={0}
      />
    );
    expect(screen.getByText(/Sin pendientes/i)).toBeInTheDocument();
    expect(screen.getByText(/No hay parcelas con cadencia vencida/i)).toBeInTheDocument();
  });

  it("muestra empty state diferente cuando hay filtro pero el set está vacío", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    // Filtrar por no_history (que tiene 0 parcelas)
    fireEvent.click(screen.getByRole("button", { name: /Sin historial: 0 parcelas/i }));
    expect(screen.getByText(/Sin pendientes/i)).toBeInTheDocument();
    expect(screen.getByText(/Ninguna parcela coincide con el filtro/i)).toBeInTheDocument();
  });

  it("cada fila linkea a /parcels/[id]", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    const porvenirLink = screen.getByRole("link", { name: /Porvenir/ });
    expect(porvenirLink).toHaveAttribute("href", "/parcels/1");
  });

  it("muestra el chip de severidad correcto en cada fila", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    // Las overdue muestran "Vencida"
    const porvenirRow = screen.getByText("Porvenir").closest("li")!;
    expect(within(porvenirRow).getByText("Vencida")).toBeInTheDocument();
    // La due_soon muestra "Vence pronto"
    const lourdesRow = screen.getByText("Lourdes").closest("li")!;
    expect(within(lourdesRow).getByText("Vence pronto")).toBeInTheDocument();
    // La ok muestra "En fecha"
    const sanJuanRow = screen.getByText("San Juan").closest("li")!;
    expect(within(sanJuanRow).getByText("En fecha")).toBeInTheDocument();
  });

  it("muestra el atraso en días (negativo = vencido N días)", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    // Porvenir tiene -10 → "10 d vencido"
    const porvenirRow = screen.getByText("Porvenir").closest("li")!;
    expect(within(porvenirRow).getByText(/10 d vencido/)).toBeInTheDocument();
    // Lourdes tiene 2 → "2 d" (próximo)
    const lourdesRow = screen.getByText("Lourdes").closest("li")!;
    expect(within(lourdesRow).getByText("2 d")).toBeInTheDocument();
  });

  it("renderiza la lista como <ul> con aria-label para accesibilidad", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    expect(
      screen.getByRole("list", { name: /parcelas que necesitan fumigación/i })
    ).toBeInTheDocument();
  });

  it("marca aria-pressed en el chip activo y false en los demás", () => {
    render(
      <OverdueList
        parcels={PARCELS}
        summary={SUMMARY}
        totalHa={20}
      />
    );
    const overdueChip = screen.getByRole("button", { name: /Vencidas: 2 parcelas/i });
    const dueSoonChip = screen.getByRole("button", { name: /Vencen esta semana: 1 parcelas/i });
    // Sin filtro activo
    expect(overdueChip).toHaveAttribute("aria-pressed", "false");
    expect(dueSoonChip).toHaveAttribute("aria-pressed", "false");
    // Activar Vencidas
    fireEvent.click(overdueChip);
    expect(overdueChip).toHaveAttribute("aria-pressed", "true");
    expect(dueSoonChip).toHaveAttribute("aria-pressed", "false");
  });
});
