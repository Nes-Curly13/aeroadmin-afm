import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanningPanel } from "@/components/dashboard/planning-panel";
import type { PhasePlanningItem } from "@/lib/phase-applications";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}));

function item(over: Partial<PhasePlanningItem> = {}): PhasePlanningItem {
  return {
    parcel_id: 1,
    land_name: "Lote 1",
    crop_type: "cana",
    start_date: "2026-01-01",
    age_days: 50,
    phase: "establecimiento",
    pending: 1,
    overdue: 0,
    nextApplication: {
      category_slug: "herbicida",
      application_type_slug: "pre_emergente",
      status: "pendiente",
      window_end: "2026-01-21"
    },
    ...over
  };
}

describe("PlanningPanel (fenológico)", () => {
  it("muestra estado vacío", () => {
    render(<PlanningPanel items={[]} />);
    expect(screen.getByTestId("planning-panel")).toBeInTheDocument();
    expect(screen.getByText(/Sin aplicaciones pendientes/i)).toBeInTheDocument();
  });

  it("lista parcelas con fase, aplicación y estado", () => {
    render(
      <PlanningPanel
        items={[
          item({ parcel_id: 1, land_name: "Vencida A", overdue: 2, pending: 0 }),
          item({ parcel_id: 2, land_name: "Pendiente B", overdue: 0, pending: 1 })
        ]}
      />
    );
    expect(screen.getByText("Vencida A")).toBeInTheDocument();
    expect(screen.getByText("Pendiente B")).toBeInTheDocument();
    expect(screen.getByText("2 vencidas")).toBeInTheDocument();
    expect(screen.getByText("1 pendiente")).toBeInTheDocument();
    const meta = screen.getAllByTestId("planning-item-meta")[0];
    expect(meta.textContent).toContain("Establecimiento");
    expect(meta.textContent).toContain("Herbicida");
    expect(meta.textContent).toContain("Pre-emergente");
  });

  it("respeta el límite", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      item({ parcel_id: i + 1, land_name: `P${i + 1}` })
    );
    render(<PlanningPanel items={items} limit={8} />);
    expect(screen.getByText("P8")).toBeInTheDocument();
    expect(screen.queryByText("P9")).not.toBeInTheDocument();
    expect(screen.getByText(/Ver las 12 parcelas/)).toBeInTheDocument();
  });
});
