// Tests del primitive Button.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button, buttonVariants } from "@/components/ui/button";

describe("Button", () => {
  it("renderiza como <button> con texto y dispara onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    const btn = screen.getByRole("button", { name: "Guardar" });
    expect(btn.tagName).toBe("BUTTON");
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("exhibe el data-slot=button", () => {
    render(<Button>Aceptar</Button>);
    expect(screen.getByRole("button", { name: "Aceptar" })).toHaveAttribute(
      "data-slot",
      "button"
    );
  });

  it("aplica el variant default por default (primary bg)", () => {
    const { container } = render(<Button>Default</Button>);
    const btn = container.querySelector("[data-slot=button]") as HTMLElement;
    expect(btn.className).toMatch(/bg-primary/);
  });

  it("cambia de variant segun el prop", () => {
    const { container } = render(<Button variant="destructive">Eliminar</Button>);
    const btn = container.querySelector("[data-slot=button]") as HTMLElement;
    expect(btn.className).toMatch(/text-destructive/);
  });

  it("cambia de size segun el prop", () => {
    const { container } = render(<Button size="sm">Pequeño</Button>);
    const btn = container.querySelector("[data-slot=button]") as HTMLElement;
    expect(btn.className).toMatch(/h-7/);
  });

  it("soporta size icon (cuadrado)", () => {
    const { container } = render(<Button size="icon" aria-label="Cerrar">×</Button>);
    const btn = container.querySelector("[data-slot=button]") as HTMLElement;
    expect(btn.className).toMatch(/size-8/);
  });

  it("respeta disabled y bloquea onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Deshabilitado
      </Button>
    );
    await userEvent.click(screen.getByRole("button", { name: "Deshabilitado" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("propaga aria-invalid al ring destructive", () => {
    const { container } = render(<Button aria-invalid>Error</Button>);
    const btn = container.querySelector("[data-slot=button]") as HTMLElement;
    expect(btn.getAttribute("aria-invalid")).toBe("true");
    expect(btn.className).toMatch(/aria-invalid/);
  });

  it("buttonVariants es una funcion pura que devuelve string", () => {
    const result = buttonVariants({ variant: "outline", size: "sm" });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/border-border/);
  });
});
