// Tests del primitive Input.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("asocia el label al input por id autogenerado", () => {
    render(<Input label="Cliente" />);
    const input = screen.getByLabelText("Cliente");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("id")).toMatch(/^input-/);
  });

  it("respeta un id explicito pasado por el caller", () => {
    render(<Input id="custom-id" label="Cliente" />);
    expect(screen.getByLabelText("Cliente").getAttribute("id")).toBe("custom-id");
  });

  it("dos Inputs con el mismo label NO colisionan sus ids", () => {
    render(
      <>
        <Input label="Cliente" />
        <Input label="Cliente" />
      </>
    );
    const inputs = screen.getAllByLabelText("Cliente");
    expect(inputs[0].getAttribute("id")).not.toBe(inputs[1].getAttribute("id"));
  });

  it("asocia el hint via aria-describedby", () => {
    render(<Input label="Hectáreas" hint="Aprox. 1 decimal" />);
    const input = screen.getByLabelText("Hectáreas");
    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).not.toBeNull();
    const hint = document.getElementById(hintId!);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("Aprox. 1 decimal");
  });

  it("NO setea aria-describedby cuando no hay hint", () => {
    render(<Input label="Cliente" />);
    expect(screen.getByLabelText("Cliente").getAttribute("aria-describedby")).toBeNull();
  });

  it("setea aria-invalid cuando invalid=true", () => {
    render(<Input label="Email" invalid />);
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  it("NO setea aria-invalid cuando invalid es false o undefined", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBeNull();
  });

  it("llama onChange al tipear", async () => {
    const onChange = vi.fn();
    render(<Input label="Cliente" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Cliente"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("respeta el prop type (email, number, etc.)", () => {
    render(<Input label="Email" type="email" />);
    expect(screen.getByLabelText("Email").getAttribute("type")).toBe("email");
  });

  it("respeta disabled", () => {
    render(<Input label="Email" disabled />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
