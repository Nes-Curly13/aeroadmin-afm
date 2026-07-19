import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UpcomingFumigations } from "@/components/dashboard/upcoming-fumigations";
import type { UpcomingFumigation } from "@/lib/types";

// (Q2 c3) Cubre el link "Ver todas (N) →" hacia /parcels/overdue.
// El componente es client island y solo depende de Next/Link, por eso se puede
// renderizar sin providers de Next.

const baseItem: UpcomingFumigation = {
  crop_type: "Maíz",
  days_until_next_due: -3,
  drone_model_name: "T40",
  external_id: "904",
  field_type: "Cultivo",
  is_orchard: false,
  last_fumigation_date: "2026-05-15",
  land_name: "Parcela 904",
  next_due_date: "2026-07-15",
  parcel_id: 904,
  recommended_cadence_days: 60,
  status: "overdue"
};

describe("UpcomingFumigations", () => {
  it("no muestra el link 'Ver todas' cuando no se pasa totalOverdue", () => {
    render(<UpcomingFumigations items={[baseItem]} />);
    expect(screen.queryByTestId("upcoming-ver-todas-overdue")).toBeNull();
  });

  it("no muestra el link cuando totalOverdue <= items.filter(overdue)", () => {
    // 1 item overdue, totalOverdue = 1 → no link (ya está visible en el top)
    render(<UpcomingFumigations items={[baseItem]} totalOverdue={1} />);
    expect(screen.queryByTestId("upcoming-ver-todas-overdue")).toBeNull();
  });

  it("muestra el link 'Ver todas (N) →' cuando totalOverdue > items.filter(overdue)", () => {
    // 1 item overdue visible, totalOverdue = 4 → quedan 3 más por ver
    render(<UpcomingFumigations items={[baseItem]} totalOverdue={4} />);
    const link = screen.getByTestId("upcoming-ver-todas-overdue");
    expect(link.getAttribute("href")).toBe("/parcels/overdue");
    expect(link.textContent).toMatch(/Ver todas \(4\)/);
  });

  it("sigue contando chips de status aunque haya link", () => {
    render(
      <UpcomingFumigations
        items={[
          baseItem,
          { ...baseItem, days_until_next_due: 3, parcel_id: 905, status: "due_soon" },
          { ...baseItem, days_until_next_due: 30, parcel_id: 906, status: "ok" }
        ]}
        totalOverdue={4}
      />
    );
    expect(screen.getByText("1 vencida")).toBeTruthy();
    expect(screen.getByText("1 pronto")).toBeTruthy();
    expect(screen.getByText("1 en fecha")).toBeTruthy();
  });
});
