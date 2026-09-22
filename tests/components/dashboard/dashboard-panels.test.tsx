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

  const farms = [{ id: 9, name: "La Esperanza" }];
  const drones = ["AFM T50-1", "AFM T40 1"];
  const base = { farms, drones, range: "90", farmId: "", drone: "", estado: "", query: "" };

  it("hacienda se puede elegir sin cliente → ?farm=", async () => {
    const user = userEvent.setup();
    render(<DashboardFilters {...base} />);
    expect(screen.getByTestId("dashboard-farm")).not.toBeDisabled();
    await user.selectOptions(screen.getByTestId("dashboard-farm"), "9");
    expect(push).toHaveBeenCalledWith("/?farm=9");
  });

  it("elegir dron navega con ?drone=", async () => {
    const user = userEvent.setup();
    render(<DashboardFilters {...base} />);
    await user.selectOptions(screen.getByTestId("dashboard-drone"), "AFM T50-1");
    expect(push).toHaveBeenCalledWith("/?drone=AFM+T50-1");
  });

  it("elegir estado navega con ?estado=", async () => {
    const user = userEvent.setup();
    render(<DashboardFilters {...base} />);
    await user.selectOptions(screen.getByTestId("dashboard-estado"), "revisar");
    expect(push).toHaveBeenCalledWith("/?estado=revisar");
  });

  it("buscar navega con ?q=", async () => {
    const user = userEvent.setup();
    render(<DashboardFilters {...base} />);
    await user.type(screen.getByTestId("dashboard-search"), "ste");
    await user.click(screen.getByRole("button", { name: /Buscar/ }));
    expect(push).toHaveBeenCalledWith("/?q=ste");
  });

  it("limpiar resetea los filtros", async () => {
    const user = userEvent.setup();
    render(<DashboardFilters {...base} range="30" farmId="9" />);
    await user.click(screen.getByTestId("dashboard-clear"));
    expect(push).toHaveBeenCalledWith("/");
  });
});
