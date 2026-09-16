// tests/components/dashboard/dashboard-panels.test.tsx
//
// Tests de los paneles nuevos del dashboard (2026-09-15): BarList,
// TrendChart, PlanCompliance y los filtros (cliente/hacienda).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Building2, Plane } from "lucide-react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

import { BarList } from "@/components/dashboard/bar-list";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { PlanCompliance } from "@/components/dashboard/plan-compliance";
import { DashboardFilters } from "@/components/dashboard/dashboard-filters";

describe("BarList", () => {
  it("renderiza items con valor y hint, y barra proporcional", () => {
    render(
      <BarList
        title="Flota por hectáreas"
        icon={Plane}
        items={[
          { key: "a", label: "T40", value: 180, valueLabel: "180 ha", hint: "60 fum." },
          { key: "b", label: "T16", value: 70, valueLabel: "70 ha" }
        ]}
      />
    );
    expect(screen.getByText("Flota por hectáreas")).toBeInTheDocument();
    expect(screen.getByText("T40")).toBeInTheDocument();
    expect(screen.getByText(/180 ha · 60 fum\./)).toBeInTheDocument();
  });

  it("empty state", () => {
    render(
      <BarList title="Mix por categoría" icon={Building2} items={[]} />
    );
    expect(screen.getByText(/Sin datos en el período/i)).toBeInTheDocument();
  });
});

describe("TrendChart", () => {
  it("renderiza buckets y título por grain", () => {
    render(
      <TrendChart
        grain="week"
        data={[
          { bucket: "2026-09-07", fumigaciones: 20, ha: 50 },
          { bucket: "2026-09-14", fumigaciones: 15, ha: 40 }
        ]}
      />
    );
    expect(screen.getByText(/Tendencia semanal/i)).toBeInTheDocument();
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
  });

  it("empty state", () => {
    render(<TrendChart grain="month" data={[]} />);
    expect(screen.getByText(/Tendencia mensual/i)).toBeInTheDocument();
    expect(screen.getByText(/Sin datos en el período/i)).toBeInTheDocument();
  });
});

describe("PlanCompliance", () => {
  it("calcula el % de cumplimiento y muestra conteos", () => {
    render(
      <PlanCompliance data={{ hechas: 6, planificadas: 3, canceladas: 1 }} />
    );
    // 6 / 10 = 60%
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 10 hechas/)).toBeInTheDocument();
    expect(screen.getByText(/Pendientes · 3/)).toBeInTheDocument();
  });

  it("sin planes → empty state", () => {
    render(
      <PlanCompliance data={{ hechas: 0, planificadas: 0, canceladas: 0 }} />
    );
    expect(screen.getByText(/Sin planes agendados/i)).toBeInTheDocument();
  });
});

describe("DashboardFilters", () => {
  beforeEach(() => push.mockReset());

  const clients = [{ id: 1, name: "Agro XYZ" }];
  const farms = [{ id: 9, name: "La Esperanza" }];

  it("hacienda deshabilitada sin cliente", () => {
    render(
      <DashboardFilters clients={clients} farms={[]} range="90" clientId="" farmId="" />
    );
    expect(screen.getByTestId("dashboard-farm")).toBeDisabled();
  });

  it("elegir cliente navega con ?client= y resetea farm", async () => {
    const user = userEvent.setup();
    render(
      <DashboardFilters clients={clients} farms={[]} range="90" clientId="" farmId="" />
    );
    await user.selectOptions(screen.getByTestId("dashboard-client"), "1");
    expect(push).toHaveBeenCalledWith("/?client=1");
  });

  it("elegir hacienda navega con client + farm", async () => {
    const user = userEvent.setup();
    render(
      <DashboardFilters clients={clients} farms={farms} range="90" clientId="1" farmId="" />
    );
    await user.selectOptions(screen.getByTestId("dashboard-farm"), "9");
    expect(push).toHaveBeenCalledWith("/?client=1&farm=9");
  });
});
