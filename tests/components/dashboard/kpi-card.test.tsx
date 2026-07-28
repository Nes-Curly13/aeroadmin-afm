// tests/components/dashboard/kpi-card.test.tsx
//
// Cobertura del V0 port de KpiCard:
//   - Renderiza label, value, hint.
//   - Icono arriba a la derecha, en una caja 28x28.
//   - Delta >= 0 → chip verde con TrendingUp y prefijo "+".
//   - Delta < 0  → chip rojo (text-destructive) con TrendingDown y SIN "+".
//   - Delta null/undefined → no se renderiza el chip.
//   - Delta = 0 → chip verde (es neutral, no rojo).
//   - data-slot="kpi-card" presente (regla del proyecto).
//   - Decimal formatting: 12.345 → "12.3%".

import { Sprout } from "lucide-react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { KpiCard } from "@/components/dashboard/kpi-card";

describe("<KpiCard />", () => {
  it("renderiza label, value e hint", () => {
    render(
      <KpiCard
        hint="vs 30 días anteriores"
        icon={Sprout}
        label="Hectáreas tratadas"
        value="123.5 ha"
      />
    );
    expect(screen.getByText("Hectáreas tratadas")).toBeInTheDocument();
    expect(screen.getByText("123.5 ha")).toBeInTheDocument();
    expect(screen.getByText("vs 30 días anteriores")).toBeInTheDocument();
  });

  it("aplica data-slot='kpi-card' al contenedor (regla del proyecto)", () => {
    const { container } = render(
      <KpiCard hint="x" icon={Sprout} label="L" value="1" />
    );
    const root = container.querySelector('[data-slot="kpi-card"]');
    expect(root).not.toBeNull();
  });

  it("renderiza el icono en una caja 28x28 (size-7)", () => {
    const { container } = render(
      <KpiCard hint="x" icon={Sprout} label="L" value="1" />
    );
    // El lucide svg es <svg> dentro de un span grid. Buscamos el span contenedor.
    const iconBox = container.querySelector("span.grid");
    expect(iconBox).not.toBeNull();
    expect(iconBox?.className).toContain("size-7");
  });

  it("delta positivo: chip con prefijo '+' y color neutral (bg-secondary)", () => {
    render(
      <KpiCard
        delta={12.5}
        hint="x"
        icon={Sprout}
        label="L"
        value="1"
      />
    );
    // El texto del chip incluye el signo + y el valor
    expect(screen.getByText("+12.5%")).toBeInTheDocument();
    // Verificamos que el chip NO es destructivo
    const chip = screen.getByText("+12.5%").closest("span");
    expect(chip?.className).toContain("bg-secondary");
    expect(chip?.className).not.toContain("text-destructive");
  });

  it("delta negativo: chip SIN '+' y color destructivo (text-destructive)", () => {
    render(
      <KpiCard
        delta={-4.2}
        hint="x"
        icon={Sprout}
        label="L"
        value="1"
      />
    );
    expect(screen.getByText("-4.2%")).toBeInTheDocument();
    const chip = screen.getByText("-4.2%").closest("span");
    expect(chip?.className).toContain("text-destructive");
    expect(chip?.className).toContain("bg-destructive/10");
  });

  it("delta = 0: chip verde (no es rojo), formato '+0.0%'", () => {
    render(
      <KpiCard
        delta={0}
        hint="x"
        icon={Sprout}
        label="L"
        value="1"
      />
    );
    expect(screen.getByText("+0.0%")).toBeInTheDocument();
    const chip = screen.getByText("+0.0%").closest("span");
    expect(chip?.className).not.toContain("text-destructive");
  });

  it("delta null: no se renderiza ningún chip de delta", () => {
    render(
      <KpiCard
        delta={null}
        hint="solo el hint"
        icon={Sprout}
        label="L"
        value="1"
      />
    );
    expect(screen.queryByText(/%/)).toBeNull();
    // El hint sigue presente
    expect(screen.getByText("solo el hint")).toBeInTheDocument();
  });

  it("delta undefined: no se renderiza ningún chip de delta", () => {
    // Omitir la prop es equivalente a undefined.
    render(
      <KpiCard hint="solo el hint" icon={Sprout} label="L" value="1" />
    );
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("formatea el delta a 1 decimal (toFixed(1))", () => {
    // 99.999 debería renderizarse como 100.0
    render(
      <KpiCard
        delta={99.99}
        hint="x"
        icon={Sprout}
        label="L"
        value="1"
      />
    );
    expect(screen.getByText("+100.0%")).toBeInTheDocument();
  });

  it("el value se renderiza en font-mono y tabular-nums", () => {
    const { container } = render(
      <KpiCard hint="x" icon={Sprout} label="L" value="42" />
    );
    const valueEl = container.querySelector("p.font-mono");
    expect(valueEl).not.toBeNull();
    expect(valueEl?.className).toContain("tabular-nums");
    expect(valueEl?.textContent).toBe("42");
  });
});
