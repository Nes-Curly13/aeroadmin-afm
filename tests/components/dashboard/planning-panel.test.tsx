import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanningPanel } from "@/components/dashboard/planning-panel";
import type { OverdueParcel } from "@/lib/types";

// next/link necesita el router mock en jsdom
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}));

function parcel(over: Partial<OverdueParcel>): OverdueParcel {
  return {
    parcel_id: 1,
    land_name: "Lote 1",
    external_id: "ext-1",
    field_type: "Farmland",
    is_orchard: false,
    drone_model_name: null,
    crop_type: "Caña de azúcar",
    recommended_cadence_days: 14,
    last_fumigation_date: "2026-08-01",
    next_due_date: "2026-08-15",
    days_until_next_due: 0,
    severity: "due_soon",
    area_fumigable_m2: 10000,
    waypoint_count: null,
    area_fumigable_ha: 1,
    ...over
  };
}

describe("PlanningPanel (OE2)", () => {
  it("muestra estado vacío cuando no hay pendientes", () => {
    render(<PlanningPanel items={[]} />);
    expect(screen.getByTestId("planning-panel")).toBeInTheDocument();
    expect(screen.getByText(/Sin parcelas pendientes/i)).toBeInTheDocument();
  });

  it("lista parcelas con su severidad y cuenta vencidas / por vencer", () => {
    const items = [
      parcel({ parcel_id: 1, land_name: "Vencida A", severity: "overdue", days_until_next_due: -3 }),
      parcel({ parcel_id: 2, land_name: "PorVencer B", severity: "due_soon", days_until_next_due: 2 })
    ];
    render(<PlanningPanel items={items} />);
    expect(screen.getByText("Vencida A")).toBeInTheDocument();
    expect(screen.getByText("PorVencer B")).toBeInTheDocument();
    expect(screen.getByText("1 vencida")).toBeInTheDocument();
    expect(screen.getByText("1 por vencer")).toBeInTheDocument();
  });

  it("respeta el límite y muestra el link 'ver todas'", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      parcel({ parcel_id: i + 1, land_name: `P${i + 1}` })
    );
    render(<PlanningPanel items={items} limit={8} />);
    expect(screen.getByText("P8")).toBeInTheDocument();
    expect(screen.queryByText("P9")).not.toBeInTheDocument();
    expect(screen.getByText(/Ver las 12 parcelas pendientes/i)).toBeInTheDocument();
  });
});
