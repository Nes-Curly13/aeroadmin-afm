import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavLinks } from "@/components/nav-links";

// Mock next/navigation so we can drive the pathname in each test.
const pathnames: string[] = [];
vi.mock("next/navigation", () => ({
  usePathname: () => pathnames[0] ?? "/"
}));

function renderAt(pathname: string) {
  pathnames[0] = pathname;
  return render(<NavLinks />);
}

describe("NavLinks — Fase 8 active state", () => {
  it("marca 'Inicio' como active en /", () => {
    renderAt("/");
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("NO marca 'Inicio' como active en otra ruta", () => {
    renderAt("/parcelas");
    const link = screen.getByRole("link", { name: "Inicio" });
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("marca 'Parcelas' como active en /parcelas exacto", () => {
    renderAt("/parcelas");
    const link = screen.getByRole("link", { name: "Parcelas" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Parcelas' como active en /parcelas/[id]", () => {
    renderAt("/parcelas/123");
    const link = screen.getByRole("link", { name: "Parcelas" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Fumigaciones' como active en /fumigaciones/nueva (sub-ruta)", () => {
    renderAt("/fumigaciones/nueva");
    const link = screen.getByRole("link", { name: "Fumigaciones" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Fumigaciones' como active en /fumigaciones/456/editar (sub-ruta profunda)", () => {
    renderAt("/fumigaciones/456/editar");
    const link = screen.getByRole("link", { name: "Fumigaciones" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Administración' como active en /admin exacto", () => {
    renderAt("/admin");
    const link = screen.getByRole("link", { name: "Administración" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Administración' como active en /admin/parcels (sub-ruta)", () => {
    renderAt("/admin/parcels");
    const link = screen.getByRole("link", { name: "Administración" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marca 'Administración' como active en /admin/calidad (sub-ruta)", () => {
    renderAt("/admin/calidad");
    const link = screen.getByRole("link", { name: "Administración" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("NO marca 'Administración' como active en una ruta no-admin", () => {
    renderAt("/reportes");
    const link = screen.getByRole("link", { name: "Administración" });
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("NO marca 'Geovisor' como active en /administracion (no false prefix match)", () => {
    // Edge case: una ruta futura que empiece con "admin" pero no sea /admin
    // no debe matchear. /administracion (hipotético) empieza con "admin"
    // pero NO con "/admin/" — el chequeo de prefix con "/" evita el false
    // positive.
    renderAt("/administracion");
    const link = screen.getByRole("link", { name: "Administración" });
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("NO marca 'Parcelas' como active en /parcelas-archivadas (no false prefix match)", () => {
    renderAt("/parcelas-archivadas");
    const link = screen.getByRole("link", { name: "Parcelas" });
    expect(link).not.toHaveAttribute("aria-current");
  });
});
