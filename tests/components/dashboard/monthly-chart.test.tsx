// tests/components/dashboard/monthly-chart.test.tsx
//
// Cobertura del V0 port de MonthlyChart:
//   - Renderiza 12 barras (o N) con label/height proporcionales.
//   - data-slot="monthly-chart" presente.
//   - role="img" + aria-label con total de ha + total de vuelos.
//   - data-state="empty" cuando data es [].
//   - data-month y data-ha en cada item (testing hooks).
//   - La altura de cada barra es proporcional a ha/maxHa (verificable vía
//     style="height: X%" inline).
//   - La posición del dot de flights es proporcional a flights/maxFlights.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MonthlyChart, type MonthlyBar } from "@/components/dashboard/monthly-chart";

const baseData: MonthlyBar[] = [
  { label: "ene", ha: 100, flights: 10 },
  { label: "feb", ha: 200, flights: 5 },
  { label: "mar", ha: 50, flights: 20 },
  { label: "abr", ha: 0, flights: 0 }
];

describe("<MonthlyChart />", () => {
  it("aplica data-slot='monthly-chart' al contenedor", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    expect(container.querySelector('[data-slot="monthly-chart"]')).not.toBeNull();
  });

  it("renderiza un bar por cada item de data", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    const items = container.querySelectorAll("[data-month]");
    expect(items.length).toBe(baseData.length);
  });

  it("renderiza las labels de los meses tal cual vienen en data", () => {
    render(<MonthlyChart data={baseData} />);
    expect(screen.getByText("ene")).toBeInTheDocument();
    expect(screen.getByText("feb")).toBeInTheDocument();
    expect(screen.getByText("mar")).toBeInTheDocument();
    expect(screen.getByText("abr")).toBeInTheDocument();
  });

  it("calcula altura de barra proporcional a ha/maxHa (feb=200 es la más alta)", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    // Buscamos el bar (el div con bg-primary/85) dentro de cada item.
    const bars = container.querySelectorAll<HTMLElement>('[data-month] [class*="bg-primary"]');
    // feb tiene ha=200 que es el max, debería tener height: 100%.
    // ene tiene ha=100 → 50%. mar tiene ha=50 → 25%. abr tiene ha=0 → max(2, 0%) = 2% (min).
    const feb = container.querySelector('[data-month="feb"] [class*="bg-primary"]') as HTMLElement;
    const ene = container.querySelector('[data-month="ene"] [class*="bg-primary"]') as HTMLElement;
    const abr = container.querySelector('[data-month="abr"] [class*="bg-primary"]') as HTMLElement;
    expect(feb.style.height).toBe("100%");
    expect(ene.style.height).toBe("50%");
    expect(abr.style.height).toBe("2%"); // floor mínimo del V0 (Math.max(2, h))
    expect(bars.length).toBe(4);
  });

  it("data-empty: cuando data está vacío, muestra estado 'Sin datos'", () => {
    const { container } = render(<MonthlyChart data={[]} />);
    const root = container.querySelector('[data-slot="monthly-chart"]');
    expect(root).not.toBeNull();
    expect(root?.getAttribute("data-state")).toBe("empty");
    expect(screen.getByText(/Sin datos/i)).toBeInTheDocument();
    // No debe haber items
    expect(container.querySelectorAll("[data-month]").length).toBe(0);
  });

  it("role='img' + aria-label con totales agregados del dataset", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    const root = container.querySelector('[data-slot="monthly-chart"]');
    expect(root?.getAttribute("role")).toBe("img");
    // Total ha = 100+200+50+0 = 350, total flights = 10+5+20+0 = 35
    const label = root?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/350 ha tratadas/);
    expect(label).toMatch(/35 vuelos/);
    expect(label).toMatch(/4 meses/);
  });

  it("el dot de flights tiene aria-hidden (es decorativo, info ya en title)", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    // El dot es el span con bg-[#16847e] y size-1.5
    const dot = container.querySelector('[data-month="ene"] span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("size-1.5");
    expect(dot?.className).toContain("rounded-full");
  });

  it("la altura de cada dot es proporcional a flights/maxFlights", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    // mar tiene flights=20 que es el max, dot en 100%.
    // ene tiene flights=10 → 50%. feb tiene flights=5 → 25%. abr tiene flights=0 → 2% (min).
    const mar = container.querySelector('[data-month="mar"] span[aria-hidden="true"]') as HTMLElement;
    const ene = container.querySelector('[data-month="ene"] span[aria-hidden="true"]') as HTMLElement;
    expect(mar.style.bottom).toBe("100%");
    expect(ene.style.bottom).toBe("50%");
  });

  it("el título de cada barra (tooltip nativo) muestra ha y flights", () => {
    const { container } = render(<MonthlyChart data={baseData} />);
    const eneBar = container.querySelector('[data-month="ene"] div[title]') as HTMLElement;
    expect(eneBar.getAttribute("title")).toBe("ene: 100 ha · 10 vuelos");
  });

  it("soporta datasets de longitud != 12 sin romperse", () => {
    const three: MonthlyBar[] = [
      { label: "x", ha: 1, flights: 1 },
      { label: "y", ha: 2, flights: 2 },
      { label: "z", ha: 3, flights: 3 }
    ];
    const { container } = render(<MonthlyChart data={three} />);
    const items = container.querySelectorAll("[data-month]");
    expect(items.length).toBe(3);
  });
});
