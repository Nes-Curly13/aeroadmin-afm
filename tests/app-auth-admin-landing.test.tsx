import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock @/lib/data porque PageHeader (transitivamente importado por la
// landing) usa `NOW` y tiene `import "server-only"` que rompe en vitest.
vi.mock("@/lib/data", () => ({
  NOW: new Date("2026-09-08T00:00:00Z")
}));

import AdminLandingPage from "@/app/(auth)/admin/page";

describe("AdminLandingPage — /admin landing (Fase 8)", () => {
  it("renderiza el header con título y descripción", () => {
    render(<AdminLandingPage />);
    // PageHeader usa un h1, CardTitle es un div — combino ambos
    expect(screen.getByRole("heading", { name: "Administración" })).toBeInTheDocument();
    expect(
      screen.getByText(/Herramientas internas para mantener la base de datos/i)
    ).toBeInTheDocument();
  });

  it("incluye link a /admin/parcels (parcelas admin)", () => {
    render(<AdminLandingPage />);
    const link = screen.getByRole("link", { name: /Parcelas \(admin\)/i });
    expect(link).toHaveAttribute("href", "/admin/parcels");
  });

  it("incluye link a /admin/parcels/new (alta de parcela)", () => {
    render(<AdminLandingPage />);
    const link = screen.getByRole("link", { name: /Nueva parcela/i });
    expect(link).toHaveAttribute("href", "/admin/parcels/new");
  });

  it("incluye link a /admin/parcels/import (importador)", () => {
    render(<AdminLandingPage />);
    const link = screen.getByRole("link", { name: /Importar parcelas/i });
    expect(link).toHaveAttribute("href", "/admin/parcels/import");
  });

  it("incluye link a /admin/calidad (data quality)", () => {
    render(<AdminLandingPage />);
    const link = screen.getByRole("link", { name: /Calidad de datos/i });
    expect(link).toHaveAttribute("href", "/admin/calidad");
  });

  it("incluye link a /admin/applications (Excel import)", () => {
    render(<AdminLandingPage />);
    const link = screen.getByRole("link", { name: /Aplicaciones importadas/i });
    expect(link).toHaveAttribute("href", "/admin/applications");
  });

  it("muestra la URL visible de cada acción (no-hover discoverability)", () => {
    render(<AdminLandingPage />);
    // El componente renderiza la URL en monospace para que sea escaneable
    expect(screen.getByText("/admin/parcels")).toBeInTheDocument();
    expect(screen.getByText("/admin/calidad")).toBeInTheDocument();
  });
});
