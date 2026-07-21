// Tests del primitive Pagination (v1.7 sprint UI).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { Pagination } from "@/components/ui/pagination";

describe("Pagination", () => {
  it("no renderiza nada si totalPages <= 1", () => {
    const { container } = render(
      <Pagination currentPage={1} onPageChange={() => {}} totalPages={1} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renderiza prev + next + la pagina actual cuando compact", () => {
    render(
      <Pagination
        compact
        currentPage={3}
        onPageChange={() => {}}
        totalPages={10}
      />
    );
    expect(screen.getByLabelText("Página anterior")).toBeInTheDocument();
    expect(screen.getByLabelText("Página siguiente")).toBeInTheDocument();
    // En compact, muestra "3 / 10" en vez de numeros individuales
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    // Y NO renderiza los numeros individuales
    expect(screen.queryByLabelText("Página 1")).toBeNull();
  });

  it("renderiza los 5 numeros visibles por defecto (current ± 2)", () => {
    render(
      <Pagination currentPage={5} onPageChange={() => {}} totalPages={20} />
    );
    for (let i = 3; i <= 7; i++) {
      expect(screen.getByLabelText(`Página ${i}`)).toBeInTheDocument();
    }
  });

  it("marca la pagina actual con aria-current='page'", () => {
    render(
      <Pagination currentPage={5} onPageChange={() => {}} totalPages={20} />
    );
    const current = screen.getByLabelText("Página 5");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("muestra elipsis cuando hay mas paginas a los costados", () => {
    render(
      <Pagination currentPage={10} onPageChange={() => {}} totalPages={50} />
    );
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });

  it("NO muestra elipsis si el rango cabe sin truncar", () => {
    render(
      <Pagination currentPage={3} onPageChange={() => {}} totalPages={5} />
    );
    expect(screen.queryByText("…")).toBeNull();
    // 5 paginas enteras: 1, 2, 3, 4, 5
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByLabelText(`Página ${i}`)).toBeInTheDocument();
    }
  });

  it("dispara onPageChange con el numero correcto al click", () => {
    const handleChange = vi.fn();
    render(
      <Pagination currentPage={5} onPageChange={handleChange} totalPages={20} />
    );
    fireEvent.click(screen.getByLabelText("Página 7"));
    expect(handleChange).toHaveBeenCalledWith(7);
  });

  it("prev/next funcionan", () => {
    const handleChange = vi.fn();
    render(
      <Pagination currentPage={5} onPageChange={handleChange} totalPages={20} />
    );
    fireEvent.click(screen.getByLabelText("Página siguiente"));
    expect(handleChange).toHaveBeenCalledWith(6);
    fireEvent.click(screen.getByLabelText("Página anterior"));
    expect(handleChange).toHaveBeenCalledWith(4);
  });

  it("prev esta disabled en la primera pagina", () => {
    render(
      <Pagination currentPage={1} onPageChange={() => {}} totalPages={10} />
    );
    const prev = screen.getByLabelText("Página anterior");
    expect(prev).toBeDisabled();
  });

  it("next esta disabled en la ultima pagina", () => {
    render(
      <Pagination currentPage={10} onPageChange={() => {}} totalPages={10} />
    );
    const next = screen.getByLabelText("Página siguiente");
    expect(next).toBeDisabled();
  });

  it("clamp del currentPage al rango valido (no rompe si currentPage > totalPages)", () => {
    // Edge case: data race entre la query y la UI. No debe crashear.
    // El algoritmo degrada: si currentPage > totalPages, muestra los
    // extremos (pagina 1 + ultima visible) sin los numeros intermedios.
    const { container } = render(
      <Pagination currentPage={15} onPageChange={() => {}} totalPages={10} />
    );
    expect(container.firstChild).not.toBeNull();
    // Pagina 1 sigue visible (boton "1")
    expect(screen.getByLabelText("Página 1")).toBeInTheDocument();
    // La pagina 10 tambien (porque end=totalPages siempre la incluye)
    expect(screen.getByLabelText("Página 10")).toBeInTheDocument();
    // Elipsis en el medio
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
  });

  it("aplica className y ariaLabel custom", () => {
    render(
      <Pagination
        ariaLabel="Cambiar página de alertas"
        className="mt-4"
        currentPage={1}
        onPageChange={() => {}}
        totalPages={5}
      />
    );
    expect(
      screen.getByLabelText("Cambiar página de alertas")
    ).toBeInTheDocument();
    const nav = screen.getByLabelText("Cambiar página de alertas");
    expect(nav.className).toContain("mt-4");
  });
});
