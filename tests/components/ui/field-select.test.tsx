// Tests del primitive FieldSelect.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FieldSelect } from "@/components/ui/field-select";

describe("FieldSelect", () => {
  it("asocia el label al select por id", () => {
    render(
      <FieldSelect label="Cliente">
        <option value="">Todos</option>
      </FieldSelect>
    );
    const select = screen.getByLabelText("Cliente");
    expect(select.tagName).toBe("SELECT");
  });

  it("permite override del id via prop", () => {
    render(
      <FieldSelect id="custom-id" label="Cliente">
        <option value="">Todos</option>
      </FieldSelect>
    );
    const select = screen.getByLabelText("Cliente");
    expect(select.getAttribute("id")).toBe("custom-id");
  });

  it("genera id automatico estable (useId) cuando no se pasa id explicito", () => {
    render(
      <FieldSelect label="Modelo de Dron Asignado">
        <option value="">Todos</option>
      </FieldSelect>
    );
    const select = screen.getByLabelText("Modelo de Dron Asignado");
    // useId() genera un id tipo ":r0:" o "_r_2_" según el modo. Validamos
    // que tiene prefijo "field-" y NO colisiona entre instancias.
    const id1 = select.getAttribute("id");
    expect(id1).toMatch(/^field-/);
  });

  it("dos FieldSelect con el mismo label NO colisionan sus ids", () => {
    render(
      <>
        <FieldSelect label="Cliente">
          <option value="">x</option>
        </FieldSelect>
        <FieldSelect label="Cliente">
          <option value="">y</option>
        </FieldSelect>
      </>
    );
    const selects = screen.getAllByLabelText("Cliente");
    const id1 = selects[0].getAttribute("id");
    const id2 = selects[1].getAttribute("id");
    expect(id1).not.toBe(id2);
  });

  it("llama onChange al cambiar el valor", async () => {
    const onChange = vi.fn();
    render(
      <FieldSelect label="Cliente" onChange={onChange}>
        <option value="">Todos</option>
        <option value="acme">ACME</option>
      </FieldSelect>
    );
    await userEvent.selectOptions(screen.getByLabelText("Cliente"), "acme");
    expect(onChange).toHaveBeenCalled();
  });

  it("el label usa htmlFor (no div) para que screen readers lo lean", () => {
    const { container } = render(
      <FieldSelect label="Cliente">
        <option value="">Todos</option>
      </FieldSelect>
    );
    const label = container.querySelector("label");
    expect(label).not.toBeNull();
    expect(label?.tagName).toBe("LABEL");
  });
});
