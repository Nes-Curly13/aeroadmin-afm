// Tests del primitive ScrollablePanel (v1.7 sprint UI).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ScrollablePanel } from "@/components/ui/scrollable-panel";

describe("ScrollablePanel", () => {
  it("renderiza children dentro de un container con overflow-y-auto", () => {
    const { container } = render(
      <ScrollablePanel>
        <p>item 1</p>
        <p>item 2</p>
      </ScrollablePanel>
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("flex");
    expect(panel.className).toContain("flex-col");
    expect(screen.getByText("item 1")).toBeInTheDocument();
    expect(screen.getByText("item 2")).toBeInTheDocument();
  });

  it("aplica maxHeight por default (40vh) via inline style", () => {
    const { container } = render(
      <ScrollablePanel>
        <p>x</p>
      </ScrollablePanel>
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.maxHeight).toBe("40vh");
  });

  it("acepta un maxHeight custom", () => {
    const { container } = render(
      <ScrollablePanel maxHeight="320px">
        <p>x</p>
      </ScrollablePanel>
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.style.maxHeight).toBe("320px");
  });

  it("acepta maxHeight en vh, em, % (cualquier valor CSS)", () => {
    const cases = ["100vh", "30rem", "50%", "calc(100vh - 64px)"];
    for (const value of cases) {
      const { container } = render(
        <ScrollablePanel maxHeight={value}>
          <p>x</p>
        </ScrollablePanel>
      );
      expect((container.firstElementChild as HTMLElement).style.maxHeight).toBe(value);
    }
  });

  it("aplica aria-label cuando se pasa", () => {
    render(
      <ScrollablePanel ariaLabel="Lista de alertas">
        <p>x</p>
      </ScrollablePanel>
    );
    expect(screen.getByLabelText("Lista de alertas")).toBeInTheDocument();
  });

  it("role default es region (screen readers lo anuncian)", () => {
    const { container } = render(
      <ScrollablePanel>
        <p>x</p>
      </ScrollablePanel>
    );
    expect(container.querySelector('[role="region"]')).toBeInTheDocument();
  });

  it("acepta un role custom (log/feed/list)", () => {
    const { container } = render(
      <ScrollablePanel role="list">
        <p>x</p>
      </ScrollablePanel>
    );
    expect(container.querySelector('[role="list"]')).toBeInTheDocument();
  });

  it("aplica className adicional", () => {
    const { container } = render(
      <ScrollablePanel className="border-t border-[#d2ddd6]">
        <p>x</p>
      </ScrollablePanel>
    );
    expect(container.firstElementChild?.className).toContain("border-t");
  });
});
