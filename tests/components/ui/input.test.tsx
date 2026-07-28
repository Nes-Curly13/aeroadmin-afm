// Tests del primitive Input (API V0 — bare input, sin wrapper de label/hint).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("renderiza con data-slot=input", () => {
    const { container } = render(<Input />);
    const input = container.querySelector("[data-slot=input]") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.tagName).toBe("INPUT");
  });

  it("className del caller se mergea con el default", () => {
    const { container } = render(<Input className="w-64" />);
    const input = container.querySelector("[data-slot=input]") as HTMLElement;
    expect(input.className).toMatch(/w-64/);
  });

  it("respeta el prop type (email, number, etc.)", () => {
    render(<Input type="email" data-testid="email" />);
    const input = screen.getByTestId("email");
    expect(input.getAttribute("type")).toBe("email");
  });

  it("respeta placeholder", () => {
    render(<Input placeholder="tu@empresa.com" data-testid="email" />);
    expect(screen.getByTestId("email").getAttribute("placeholder")).toBe(
      "tu@empresa.com"
    );
  });

  it("respeta disabled", () => {
    render(<Input disabled data-testid="email" />);
    const input = screen.getByTestId("email") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.className).toMatch(/disabled:cursor-not-allowed/);
  });

  it("propaga aria-invalid al element + ring destructive", () => {
    render(<Input aria-invalid data-testid="email" />);
    const input = screen.getByTestId("email");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.className).toMatch(/aria-invalid:border-destructive/);
  });

  it("llama onChange al tipear", async () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} data-testid="email" />);
    await userEvent.type(screen.getByTestId("email"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("respeta el value (controlled)", () => {
    render(<Input value="hello" readOnly data-testid="email" />);
    expect((screen.getByTestId("email") as HTMLInputElement).value).toBe("hello");
  });

  it("name prop se respeta (form integration)", () => {
    render(<Input name="email" data-testid="email" />);
    expect(screen.getByTestId("email").getAttribute("name")).toBe("email");
  });
});
