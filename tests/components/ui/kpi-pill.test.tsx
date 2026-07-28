// Tests del primitive KpiPill.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { KpiPill } from "@/components/ui/kpi-pill";

describe("KpiPill", () => {
  it("renderiza todos los items con su label y value", () => {
    render(
      <KpiPill
        items={[
          { kind: "aplicaciones", value: 12 },
          { kind: "hectareas", value: "34.5 ha" },
          { kind: "volumen", value: "123 L" },
          { kind: "vuelos", value: 5 }
        ]}
      />
    );
    const group = screen.getByRole("group", { name: "Resumen del filtro actual" });
    expect(within(group).getByText("Aplicaciones")).toBeInTheDocument();
    expect(within(group).getByText("Hectáreas tratadas")).toBeInTheDocument();
    expect(within(group).getByText("Volumen")).toBeInTheDocument();
    expect(within(group).getByText("Vuelos")).toBeInTheDocument();
    expect(within(group).getByText("12")).toBeInTheDocument();
    expect(within(group).getByText("34.5 ha")).toBeInTheDocument();
    expect(within(group).getByText("123 L")).toBeInTheDocument();
    expect(within(group).getByText("5")).toBeInTheDocument();
  });

  it("acepta label y value custom sin kind", () => {
    render(
      <KpiPill
        items={[{ label: "Custom", value: "42" }]}
      />
    );
    const group = screen.getByRole("group");
    expect(within(group).getByText("Custom")).toBeInTheDocument();
    expect(within(group).getByText("42")).toBeInTheDocument();
  });

  it("marca los iconos como aria-hidden", () => {
    const { container } = render(
      <KpiPill items={[{ kind: "aplicaciones", value: 1 }]} />
    );
    // lucide-react renders <svg aria-hidden> by default
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
});
