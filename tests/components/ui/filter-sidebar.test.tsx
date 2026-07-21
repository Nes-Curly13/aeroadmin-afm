// Tests del primitive FilterSidebar (v1.7 sprint UI).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  FilterSidebar,
  FilterSidebarSection
} from "@/components/ui/filter-sidebar";

describe("FilterSidebar", () => {
  it("renderiza children", () => {
    render(
      <FilterSidebar title="Filtros">
        <p>item 1</p>
      </FilterSidebar>
    );
    expect(screen.getByText("item 1")).toBeInTheDocument();
  });

  it("muestra el titulo cuando se pasa", () => {
    render(
      <FilterSidebar title="Filtros del mapa">
        <p>x</p>
      </FilterSidebar>
    );
    expect(
      screen.getByRole("heading", { name: "Filtros del mapa" })
    ).toBeInTheDocument();
  });

  it("muestra el subtitulo cuando se pasa", () => {
    render(
      <FilterSidebar subtitle="Selecciona los drones a mostrar">
        <p>x</p>
      </FilterSidebar>
    );
    expect(
      screen.getByText("Selecciona los drones a mostrar")
    ).toBeInTheDocument();
  });

  it("muestra el badge de resultado con el conteo", () => {
    render(
      <FilterSidebar resultCount={12} resultLabel="parcelas" title="Filtros">
        <p>x</p>
      </FilterSidebar>
    );
    // El badge dice "12 parcelas". El aria-label es mas explicito.
    expect(screen.getByLabelText("12 parcelas")).toBeInTheDocument();
  });

  it("usa 'resultados' como label default", () => {
    render(
      <FilterSidebar resultCount={47} title="Filtros">
        <p>x</p>
      </FilterSidebar>
    );
    expect(screen.getByLabelText("47 resultados")).toBeInTheDocument();
  });

  it("muestra el boton de limpiar y dispara callback", () => {
    const handleClear = vi.fn();
    render(
      <FilterSidebar onClear={handleClear} title="Filtros">
        <p>x</p>
      </FilterSidebar>
    );
    const button = screen.getByRole("button", { name: /limpiar filtros/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(handleClear).toHaveBeenCalledTimes(1);
  });

  it("acepta un label custom para limpiar", () => {
    const handleClear = vi.fn();
    render(
      <FilterSidebar clearLabel="Reset" onClear={handleClear} title="Filtros">
        <p>x</p>
      </FilterSidebar>
    );
    expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
  });

  it("NO muestra el boton limpiar si onClear no se pasa", () => {
    render(
      <FilterSidebar title="Filtros">
        <p>x</p>
      </FilterSidebar>
    );
    expect(screen.queryByRole("button", { name: /limpiar/i })).toBeNull();
  });

  it("acepta className adicional", () => {
    const { container } = render(
      <FilterSidebar className="w-80" title="x">
        <p>x</p>
      </FilterSidebar>
    );
    expect(container.firstElementChild?.className).toContain("w-80");
  });

  it("NO muestra el header si no se pasa nada", () => {
    const { container } = render(
      <FilterSidebar>
        <p>x</p>
      </FilterSidebar>
    );
    // El header tiene border-b. Si no hay titulo/subtitle/clear, no se renderiza.
    const header = container.querySelector("header");
    expect(header).toBeNull();
  });
});

describe("FilterSidebarSection", () => {
  it("muestra el titulo del section", () => {
    render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection title="Drones">
          <p>x</p>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.getByRole("heading", { name: "Drones" })).toBeInTheDocument();
  });

  it("muestra el count total y el activeCount", () => {
    render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection activeCount={2} count={12} title="Drones">
          <p>x</p>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.getByLabelText("2 activos")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("NO muestra el badge active si activeCount es 0 o undefined", () => {
    render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection activeCount={0} count={12} title="Drones">
          <p>x</p>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.queryByLabelText(/activo/i)).toBeNull();
  });

  it("renderiza children dentro del section", () => {
    render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection title="Drones">
          <label>
            <input type="checkbox" /> Agras T40
          </label>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.getByLabelText(/agras t40/i)).toBeInTheDocument();
  });

  it("se puede colapsar con onToggleCollapsed", () => {
    const handleToggle = vi.fn();
    const { container } = render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection
          collapsed={false}
          onToggleCollapsed={handleToggle}
          title="Drones"
        >
          <p>contenido visible</p>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.getByText("contenido visible")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /drones/i });
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(handleToggle).toHaveBeenCalledTimes(1);
    // El estado collapsed se controla desde el padre. Simulamos re-render.
    expect(container).toBeInTheDocument();
  });

  it("oculta children cuando collapsed=true", () => {
    render(
      <FilterSidebar title="Filtros">
        <FilterSidebarSection collapsed onToggleCollapsed={() => {}} title="Drones">
          <p>contenido oculto</p>
        </FilterSidebarSection>
      </FilterSidebar>
    );
    expect(screen.queryByText("contenido oculto")).toBeNull();
    const button = screen.getByRole("button", { name: /drones/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("usa el titulo como aria-label del sidebar", () => {
    render(
      <FilterSidebar title="Filtros del mapa">
        <p>x</p>
      </FilterSidebar>
    );
    expect(screen.getByLabelText("Filtros del mapa")).toBeInTheDocument();
  });
});
