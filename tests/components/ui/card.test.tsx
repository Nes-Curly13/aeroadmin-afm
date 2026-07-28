// Tests del primitive Card.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

describe("Card", () => {
  it("renderiza children dentro de un div con data-slot=card", () => {
    const { container } = render(<Card>contenido</Card>);
    const card = container.querySelector("[data-slot=card]") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.textContent).toBe("contenido");
  });

  it("data-size=default por default", () => {
    const { container } = render(<Card>x</Card>);
    const card = container.querySelector("[data-slot=card]") as HTMLElement;
    expect(card.getAttribute("data-size")).toBe("default");
  });

  it("respeta size=sm", () => {
    const { container } = render(<Card size="sm">x</Card>);
    const card = container.querySelector("[data-slot=card]") as HTMLElement;
    expect(card.getAttribute("data-size")).toBe("sm");
  });

  it("compone Header/Title/Description con slots correctos", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Título</CardTitle>
          <CardDescription>Descripción</CardDescription>
        </CardHeader>
      </Card>
    );
    expect(container.querySelector('[data-slot="card-header"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="card-title"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="card-description"]')).not.toBeNull();
    expect(screen.getByText("Título")).toBeInTheDocument();
    expect(screen.getByText("Descripción")).toBeInTheDocument();
  });

  it("compone Content y Footer", () => {
    const { container } = render(
      <Card>
        <CardContent>Cuerpo</CardContent>
        <CardFooter>Pie</CardFooter>
      </Card>
    );
    expect(container.querySelector('[data-slot="card-content"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="card-footer"]')).not.toBeNull();
    expect(screen.getByText("Cuerpo")).toBeInTheDocument();
    expect(screen.getByText("Pie")).toBeInTheDocument();
  });

  it("CardAction se posiciona via grid (col-start-2)", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Con acción</CardTitle>
          <CardAction>×</CardAction>
        </CardHeader>
      </Card>
    );
    const action = container.querySelector('[data-slot="card-action"]') as HTMLElement;
    expect(action.className).toMatch(/col-start-2/);
  });

  it("className extra del caller se mergea con el default", () => {
    const { container } = render(<Card className="mt-4">x</Card>);
    const card = container.querySelector("[data-slot=card]") as HTMLElement;
    expect(card.className).toMatch(/mt-4/);
  });
});
