// Tests de los primitives BentoGrid + BentoCard (v1.7 sprint UI).
//
// Cobertura:
//   - BentoGrid renderiza children con role/aria correctos.
//   - BentoCard aplica col-span/row-span segun size semantico o custom.
//   - size shortcut toma prioridad sobre colSpan/rowSpan custom.
//   - spanToClass genera las clases Tailwind correctas.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  BentoCard,
  BentoGrid,
  spanToClass,
  type BentoSpans
} from "@/components/ui/bento-grid";

describe("BentoGrid", () => {
  it("renderiza children con un landmark por defecto", () => {
    render(
      <BentoGrid ariaLabel="Dashboard bento">
        <div>hijo 1</div>
        <div>hijo 2</div>
      </BentoGrid>
    );
    const region = screen.getByLabelText("Dashboard bento");
    expect(region).toBeInTheDocument();
    expect(screen.getByText("hijo 1")).toBeInTheDocument();
    expect(screen.getByText("hijo 2")).toBeInTheDocument();
  });

  it("aplica el className adicional (opcional)", () => {
    const { container } = render(
      <BentoGrid ariaLabel="x" className="gap-6">
        <div>x</div>
      </BentoGrid>
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain("gap-6");
  });
});

describe("BentoCard size shortcut", () => {
  it("sm → col-span-3 en xl", () => {
    const { container } = render(
      <BentoCard size="sm">
        <p>KPI</p>
      </BentoCard>
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("xl:col-span-3");
  });

  it("md → col-span-6 en xl", () => {
    const { container } = render(
      <BentoCard size="md">
        <p>md</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("xl:col-span-6");
  });

  it("lg → col-span-8 en xl", () => {
    const { container } = render(
      <BentoCard size="lg">
        <p>lg</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("xl:col-span-8");
  });

  it("xl → col-span-12 en xl (full width)", () => {
    const { container } = render(
      <BentoCard size="xl">
        <p>xl</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("xl:col-span-12");
  });

  it("hero → col-span-12 + row-span-2 en xl", () => {
    const { container } = render(
      <BentoCard size="hero">
        <p>hero</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("xl:col-span-12");
    expect(container.firstElementChild?.className).toContain("xl:row-span-2");
  });

  it("data-bento-size expone el shortcut para tests/styling", () => {
    const { container } = render(
      <BentoCard size="md" testId="card-md">
        <p>md</p>
      </BentoCard>
    );
    expect(container.querySelector("[data-bento-size='md']")).toBeInTheDocument();
  });
});

describe("BentoCard custom spans", () => {
  it("colSpan como numero aplica a xl", () => {
    const { container } = render(
      <BentoCard colSpan={5}>
        <p>5</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("col-span-5");
  });

  it("colSpan como object genera clases por breakpoint", () => {
    const { container } = render(
      <BentoCard colSpan={{ sm: 2, lg: 4, xl: 10 }}>
        <p>x</p>
      </BentoCard>
    );
    const cls = container.firstElementChild?.className as string;
    expect(cls).toContain("sm:col-span-2");
    expect(cls).toContain("lg:col-span-4");
    expect(cls).toContain("xl:col-span-10");
    // No debe haber un breakpoint que no se seteo
    expect(cls).not.toContain("md:col-span-");
  });

  it("rowSpan se aplica cuando se pasa (number o object)", () => {
    const { container: c1 } = render(
      <BentoCard colSpan={12} rowSpan={2}>
        <p>rs2</p>
      </BentoCard>
    );
    expect(c1.firstElementChild?.className).toContain("row-span-2");

    const { container: c2 } = render(
      <BentoCard colSpan={12} rowSpan={{ sm: 1, xl: 3 }}>
        <p>rs</p>
      </BentoCard>
    );
    expect(c2.firstElementChild?.className).toContain("sm:row-span-1");
    expect(c2.firstElementChild?.className).toContain("xl:row-span-3");
  });

  it("size shortcut toma prioridad sobre colSpan custom", () => {
    // size="sm" mapea a xl:col-span-3. Aunque pasemos colSpan={12},
    // gana el shortcut.
    const { container } = render(
      <BentoCard size="sm" colSpan={12}>
        <p>size wins</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("xl:col-span-3");
    expect(container.firstElementChild?.className).not.toContain("col-span-12");
  });
});

describe("BentoCard a11y + className", () => {
  it("aplica aria-label cuando se pasa", () => {
    render(
      <BentoCard ariaLabel="Fumigaciones recientes" size="md">
        <p>x</p>
      </BentoCard>
    );
    expect(screen.getByLabelText("Fumigaciones recientes")).toBeInTheDocument();
  });

  it("aplica role semantico cuando se pasa", () => {
    const { container } = render(
      <BentoCard role="region" size="md">
        <p>x</p>
      </BentoCard>
    );
    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
  });

  it("aplica className adicional", () => {
    const { container } = render(
      <BentoCard className="border-red-500" size="md">
        <p>x</p>
      </BentoCard>
    );
    expect(container.firstElementChild?.className).toContain("border-red-500");
  });

  it("tiene el border y shadow del design system (sanity check)", () => {
    const { container } = render(
      <BentoCard size="md">
        <p>x</p>
      </BentoCard>
    );
    const cls = container.firstElementChild?.className as string;
    expect(cls).toContain("rounded-2xl");
    expect(cls).toContain("bg-white");
    expect(cls).toContain("shadow-");
  });
});

describe("spanToClass helper", () => {
  it("numero simple -> clase unica sin breakpoint prefix", () => {
    expect(spanToClass(5, "col")).toBe("col-span-5");
    expect(spanToClass(3, "row")).toBe("row-span-3");
  });

  it("object -> clases por breakpoint, solo las definidas", () => {
    const spans: BentoSpans = { md: 6, xl: 12 };
    expect(spanToClass(spans, "col")).toBe("md:col-span-6 xl:col-span-12");
  });

  it("object vacio -> string vacio (no genera clases default)", () => {
    expect(spanToClass({}, "col")).toBe("");
  });
});
