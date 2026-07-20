import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "@/components/ui/empty-state";

describe("EmptyState", () => {
  it("renderiza title y description", () => {
    render(<EmptyState description="No hay items." title="Sin items" />);
    expect(screen.getByText("Sin items")).toBeTruthy();
    expect(screen.getByText("No hay items.")).toBeTruthy();
  });

  it("renderiza eyebrow cuando se pasa", () => {
    render(
      <EmptyState
        description="Desc"
        eyebrow="Faltan por fumigar"
        title="Sin pendientes"
      />
    );
    expect(screen.getByText("Faltan por fumigar")).toBeTruthy();
  });

  it("renderiza CTA con href como link", () => {
    render(
      <EmptyState
        cta={{ href: "/dashboard", label: "Ir al dashboard" }}
        description="Desc"
        title="Title"
      />
    );
    const link = screen.getByRole("link", { name: "Ir al dashboard" });
    expect(link.getAttribute("href")).toBe("/dashboard");
  });

  it("renderiza CTA sin href como button", () => {
    render(
      <EmptyState
        cta={{ label: "Acción", onClick: () => {} }}
        description="Desc"
        title="Title"
      />
    );
    expect(screen.getByRole("button", { name: "Acción" })).toBeTruthy();
  });

  it("acepta icon como children y lo renderiza", () => {
    render(
      <EmptyState
        description="Desc"
        icon={<span data-testid="custom-icon">★</span>}
        title="Title"
      />
    );
    expect(screen.getByTestId("custom-icon")).toBeTruthy();
  });

  it("respeta testId y size sm (padding menor)", () => {
    const { container } = render(
      <EmptyState description="Desc" size="sm" testId="my-empty" title="Title" />
    );
    const root = container.querySelector('[data-testid="my-empty"]');
    expect(root).toBeTruthy();
    expect(root?.className).toContain("p-6");
  });
});
