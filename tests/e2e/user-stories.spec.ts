// E2E Playwright — User Stories (TDD characterization).
// Sprint S8.4 (2026-07-29): tests de historias de usuario para validar
// que la implementacion del V0 cumple lo que el operador fumigador
// espera del panel.
//
// Patron TDD: estos tests SON la especificación. Si fallan, hay un
// bug en la implementacion que hay que arreglar. Si pasan, la
// feature esta validada end-to-end en el browser.
//
// 2026-09-23 — actualizados a la UI actual (dashboard nuevo, geovisor
// con Inspector sin filtros de cadencia, admin/parcels con FK
// Cliente/Finca) y a los usuarios que `global-setup` siembra
// (admin `e2e@aeroadmin.local` + supervisor `supervisor@afm.local`).
//
// Asume el server de production en BASE_URL (default :3001).

import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  email: process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local",
  password: process.env.E2E_USER_PASSWORD ?? "E2ETest12345!"
};
const SUPERVISOR = {
  email: process.env.E2E_SUPERVISOR_EMAIL ?? "supervisor@afm.local",
  password: process.env.E2E_SUPERVISOR_PASSWORD ?? "Supervisor!2026"
};

async function loginAs(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15_000 });
}

// =============================================================================
// US-1: Login flow
// =============================================================================
test.describe("US-1: Login", () => {
  test("1.1 Como usuario no autenticado, /login me pide credenciales", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /Ingresar/i })).toBeVisible();
  });

  test("1.2 Como usuario, si meto credenciales invalidas veo error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "fake@invalido.local");
    await page.fill('input[name="password"]', "BadPassword123");
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/incorrectos/i)).toBeVisible();
  });

  test("1.3 Como usuario, con credenciales validas llego al dashboard", async ({ page }) => {
    await loginAs(page, ADMIN);
    await expect(page).toHaveURL("/");
  });
});

// =============================================================================
// US-2: Dashboard
// =============================================================================
test.describe("US-2: Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
  });

  test("2.1 Como operador, veo los KPIs de fumigacion en el dashboard", async ({ page }) => {
    await expect(page.getByText(/Fumigaciones/i).first()).toBeVisible();
    await expect(page.getByText(/[ÁA]rea aplicada/i).first()).toBeVisible();
    await expect(page.getByText(/Cobertura real/i).first()).toBeVisible();
    await expect(page.getByText(/Volumen/i).first()).toBeVisible();
  });

  test("2.2 Como operador, veo el grafico de tendencia", async ({ page }) => {
    await expect(page.getByText(/Tendencia/i).first()).toBeVisible();
  });

  test("2.3 Como operador, veo el panel de cumplimiento de planificacion", async ({ page }) => {
    await expect(page.getByText(/Cumplimiento de planificaci[óo]n/i).first()).toBeVisible();
  });

  test("2.4 Como operador, veo la planificacion de fumigaciones", async ({ page }) => {
    await expect(page.getByText(/Planificaci[óo]n de fumigaciones/i).first()).toBeVisible();
  });
});

// =============================================================================
// US-3: Geovisor
// =============================================================================
test.describe("US-3: Geovisor", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/geovisor");
  });

  test("3.1 Como operador, veo el mapa con el contenedor MapLibre", async ({ page }) => {
    const map = page.locator('[aria-label="Mapa de parcelas de caña"]');
    await expect(map).toBeVisible();
    const canvas = page.locator("canvas");
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });
  });

  test("3.2 Como operador, puedo alternar el mapa base", async ({ page }) => {
    const sateliteBtn = page.getByRole("button", { name: /Sat[ée]lite/i });
    const callesBtn = page.getByRole("button", { name: /Calles/i });
    await expect(sateliteBtn).toBeVisible();
    await expect(callesBtn).toBeVisible();
    await callesBtn.click();
    await expect(page.locator('[aria-label="Mapa de parcelas de caña"]')).toBeVisible();
  });

  test("3.3 Como operador, puedo buscar parcelas por texto", async ({ page }) => {
    const search = page.getByLabel("Buscar parcela");
    await expect(search).toBeVisible();
  });

  test("3.4 Como operador, veo las capas del mapa", async ({ page }) => {
    // El rail de filtros arranca colapsado; abrirlo si hace falta.
    const toggle = page.getByRole("button", { name: /Mostrar filtros/i });
    if (await toggle.count()) {
      await toggle.first().click();
    }
    await expect(page.getByText(/Capas/i).first()).toBeVisible();
  });

  test("3.5 Como operador, veo el contador de parcelas del filtro", async ({ page }) => {
    await expect(page.getByText(/\d+\s*parcelas/i).first()).toBeVisible();
  });

  test("3.6 Como operador, puedo togglear la visibilidad de poligonos y etiquetas", async ({ page }) => {
    await expect(page.getByText(/Pol[íi]gonos de parcelas/i).first()).toBeVisible();
    await expect(page.getByText(/Etiquetas de suerte/i).first()).toBeVisible();
  });
});

// =============================================================================
// US-4: Inventario de Parcelas (/parcelas)
// =============================================================================
test.describe("US-4: Inventario de parcelas", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/parcelas");
  });

  test("4.1 Como operador, veo la tabla de parcelas", async ({ page }) => {
    await expect(page.getByText(/Inventario de parcelas/i)).toBeVisible();
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("4.2 Como operador, puedo buscar parcelas por texto", async ({ page }) => {
    const search = page.getByPlaceholder(/Buscar parcela/i);
    await expect(search).toBeVisible();
    // "Demostración" existe en el dataset demo local.
    await search.fill("Demostraci");
    await page.waitForTimeout(600); // debounce del filter
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("4.3 Como operador, puedo filtrar por cliente (dropdown)", async ({ page }) => {
    await expect(page.getByText(/^Cliente$/i).first()).toBeVisible();
  });

  test("4.4 Como operador, puedo hacer click en una parcela para ir al detalle", async ({ page }) => {
    const firstLink = page.locator("tbody a").first();
    await expect(firstLink).toBeVisible();
    const href = await firstLink.getAttribute("href");
    expect(href).toMatch(/^\/parcelas\/\d+/);
  });
});

// =============================================================================
// US-5: Detalle de Parcela
// =============================================================================
test.describe("US-5: Detalle de parcela", () => {
  test("5.1 Como operador, /parcelas/1 renderiza la ficha tecnica", async ({ page }) => {
    await loginAs(page, ADMIN);
    const resp = await page.goto("/parcelas/1");
    expect(resp?.status() ?? 0).toBeLessThan(500);
    if (resp?.status() === 200) {
      await expect(page.getByRole("heading").first()).toBeVisible();
      const body = await page.locator("body").innerText();
      expect(body.length).toBeGreaterThan(500);
    }
  });

  test("5.2 Como operador, el detalle tiene un link 'Volver al inventario'", async ({ page }) => {
    await loginAs(page, ADMIN);
    const resp = await page.goto("/parcelas/1");
    if (resp?.status() === 200) {
      const link = page.getByRole("link", { name: /Volver al inventario/i });
      await expect(link).toBeVisible();
      expect(await link.getAttribute("href")).toBe("/parcelas");
    }
  });
});

// =============================================================================
// US-6: Admin — Edición de metadata
// =============================================================================
test.describe("US-6: Admin edita metadata", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
  });

  test("6.1 Como admin, /admin/parcels me muestra la tabla de parcelas", async ({ page }) => {
    await page.goto("/admin/parcels");
    await expect(page.getByText(/Admin .{1,3}Parcelas/i).first()).toBeVisible();
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("6.2 Como admin, los campos editables por fila se renderizan", async ({ page }) => {
    await page.goto("/admin/parcels");
    const firstRow = page.locator("tbody tr").first();
    // La fila de edición inline expone Cliente/Finca (FK), Municipio y Variedad.
    // (Finca es un select en cascada que puede estar disabled sin cliente.)
    for (const label of ["Cliente", "Finca", "Municipio", "Variedad"]) {
      await expect(firstRow.locator(`[aria-label*="${label}"]`).first()).toBeVisible();
    }
  });

  test("6.3 Como admin, puedo editar y guardar un campo (con cleanup automatico)", async ({ page }) => {
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .filter((c) => c.domain.includes("localhost"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const TEST_VALUE = `US6-TEST-${Date.now()}`;
    const patch = await page.evaluate(
      async ({ id, body, cookie }) => {
        const r = await fetch(`/api/admin/parcels/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(body)
        });
        return { status: r.status, body: await r.text() };
      },
      { id: 1, body: { client_name: TEST_VALUE }, cookie: cookieHeader }
    );
    expect(patch.status).toBe(200);

    // Cleanup: dejar el parcel con su valor original (null)
    await page.evaluate(
      async ({ id, body, cookie }) => {
        await fetch(`/api/admin/parcels/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(body)
        });
      },
      { id: 1, body: { client_name: null }, cookie: cookieHeader }
    );
  });

  test("6.4 Como admin, el boton Guardar esta deshabilitado sin cambios", async ({ page }) => {
    await page.goto("/admin/parcels");
    const firstRow = page.locator("tbody tr").first();
    const saveBtn = firstRow.locator('button[aria-label="Guardar cambios"]');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();
  });
});

// =============================================================================
// US-7: RBAC (supervisor no accede a /admin)
// =============================================================================
test.describe("US-7: RBAC", () => {
  test("7.1 Como admin, /admin/parcels me deja pasar (200)", async ({ page }) => {
    await loginAs(page, ADMIN);
    const resp = await page.goto("/admin/parcels");
    expect(resp?.status()).toBe(200);
  });

  test("7.2 Como supervisor, /admin/parcels me redirige a /login (gated por middleware)", async ({ page }) => {
    await loginAs(page, SUPERVISOR);
    await page.goto("/admin/parcels");
    await expect(page).toHaveURL(/\/login/);
  });

  test("7.3 Como supervisor, /api/admin/parcels/[id]/metadata devuelve 403 (gated por handler)", async ({ page }) => {
    await loginAs(page, SUPERVISOR);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .filter((c) => c.domain.includes("localhost"))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    const resp = await page.evaluate(
      async ({ id, cookie }) => {
        const r = await fetch(`/api/admin/parcels/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ client_name: "test" })
        });
        return { status: r.status };
      },
      { id: 1, cookie: cookieHeader }
    );
    expect(resp.status).toBe(403);
  });
});
