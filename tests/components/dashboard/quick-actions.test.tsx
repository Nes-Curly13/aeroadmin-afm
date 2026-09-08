import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuickActions } from "@/components/dashboard/quick-actions";

describe("QuickActions — Fase 8 dashboard", () => {
  it("renderiza el card con título + descripción intro", () => {
    render(<QuickActions />);
    // CardTitle es un <div>, no un heading role — uso getByText
    expect(screen.getByText("Acciones rápidas")).toBeInTheDocument();
    expect(screen.getByText(/Lo más usado del día a día/i)).toBeInTheDocument();
  });

  it("incluye link 'Nueva fumigación' apuntando al wizard", () => {
    render(<QuickActions />);
    const link = screen.getByRole("link", { name: /Nueva fumigación/i });
    expect(link).toHaveAttribute("href", "/fumigaciones/nueva");
  });

  it("incluye link 'Abrir geovisor' apuntando al mapa", () => {
    render(<QuickActions />);
    const link = screen.getByRole("link", { name: /Abrir geovisor/i });
    expect(link).toHaveAttribute("href", "/geovisor");
  });

  it("incluye link 'Nueva parcela' apuntando al admin", () => {
    render(<QuickActions />);
    const link = screen.getByRole("link", { name: /Nueva parcela/i });
    expect(link).toHaveAttribute("href", "/admin/parcels/new");
  });

  it("incluye link 'Ver reportes' apuntando a /reportes", () => {
    render(<QuickActions />);
    const link = screen.getByRole("link", { name: /Ver reportes/i });
    expect(link).toHaveAttribute("href", "/reportes");
  });

  it("cada link tiene descripción visible para discoverability sin hover", () => {
    render(<QuickActions />);
    expect(screen.getByText(/Wizard 4 pasos/i)).toBeInTheDocument();
    expect(screen.getByText(/Mapa con parcelas y fumigaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/Dibujar polígono sobre el mapa satelital/i)).toBeInTheDocument();
    expect(screen.getByText(/Resumen operativo y por hacienda/i)).toBeInTheDocument();
  });

  it("NO incluye más de 5 acciones (limite de ruido)", () => {
    render(<QuickActions />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeLessThanOrEqual(5);
  });
});
