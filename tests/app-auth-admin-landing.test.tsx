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

  it("no muestra la URL cruda en el render (UI-12)", () => {
    // UI-12: el operador fumigador no es dev; mostrar "/admin/parcels"
    // en monospace era ruido. La URL queda en el href del <Link>
    // (accesible por teclado y screen reader; el hover del cursor
    // muestra la URL en el browser). Esto verifica que el <p>{href}</p>
    // NO esta presente.
    render(<AdminLandingPage />);
    expect(screen.queryByText("/admin/parcels")).not.toBeInTheDocument();
  });
});
