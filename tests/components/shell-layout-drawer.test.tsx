import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ShellLayout } from "@/components/shell-layout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/parcelas"
}));

vi.mock("@/app/(public)/login/actions", () => ({
  logoutAction: vi.fn()
}));

function renderShell() {
  return render(
    <ShellLayout user={{ email: "operador@afm.local" }} role="admin">
      <div>Contenido de la página</div>
    </ShellLayout>
  );
}

describe("ShellLayout — drawer mobile (Sheet, PR-2c)", () => {
  it("renderiza la sidebar desktop como <aside> con navegación", () => {
    renderShell();
    const aside = screen.getByLabelText("Barra lateral");
    expect(aside.tagName).toBe("ASIDE");
    expect(within(aside).getByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();
  });

  it("no monta el drawer hasta abrir el trigger", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("abre el drawer con título accesible y navegación", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Menú de navegación")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("navigation", { name: "Navegación principal" })
    ).toBeInTheDocument();
  });

  it("cierra el drawer con el botón 'Cerrar menú'", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar menú" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cierra el drawer con Escape", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
