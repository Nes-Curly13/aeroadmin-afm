// Tests del primitive PageHeader.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageHeader } from "@/components/ui/page-header";

describe("PageHeader", () => {
  it("renderiza el titulo como h1", () => {
    render(<PageHeader title="Mapa de Parcelas" />);
    expect(screen.getByRole("heading", { level: 1, name: "Mapa de Parcelas" })).toBeInTheDocument();
  });

  it("renderiza el eyebrow si se pasa", () => {
    render(<PageHeader eyebrow="Vista operativa" title="Mapa" />);
    expect(screen.getByText("Vista operativa")).toBeInTheDocument();
  });

  it("renderiza la descripcion si se pasa", () => {
    render(<PageHeader title="Mapa" description="Detalle operativo" />);
    expect(screen.getByText("Detalle operativo")).toBeInTheDocument();
  });

  it("renderiza actions y meta", () => {
    render(
      <PageHeader
        actions={<button>Exportar</button>}
        meta="Datos al 2026-07-28 09:00"
        title="Mapa"
      />
    );
    expect(screen.getByRole("button", { name: "Exportar" })).toBeInTheDocument();
    expect(screen.getByText("Datos al 2026-07-28 09:00")).toBeInTheDocument();
  });

  it("omite el border si bordered=false", () => {
    const { container } = render(<PageHeader bordered={false} title="Mapa" />);
    const header = container.querySelector("header");
    expect(header?.className).not.toMatch(/border-b/);
  });

  it("incluye el border por default", () => {
    const { container } = render(<PageHeader title="Mapa" />);
    const header = container.querySelector("header");
    expect(header?.className).toMatch(/border-b/);
  });
});
