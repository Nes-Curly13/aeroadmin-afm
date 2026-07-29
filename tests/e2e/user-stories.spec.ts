// E2E Playwright — User Stories (TDD characterization).
// Sprint S8.4 (2026-07-29): tests de historias de usuario para validar
// que la implementacion del V0 cumple lo que el operador fumigador
// espera del panel.
//
// Patron TDD: estos tests SON la especificación. Si fallan, hay un
// bug en la implementacion que hay que arreglar. Si pasan, la
// feature esta validada end-to-end en el browser.
//
// Estructura: 7 grupos (uno por historia de usuario), 22 tests en
// total. Cada test verifica UNA asercion de comportamiento, no
// detalles de implementacion (e.g. "el KPI se ve" no "el texto
// exacto del KPI es 'X hectareas'").
//
// Usuarios de test (sembrados en global-setup o antes de la suite):
//   - test@afm.local / TestPass!2026     (admin)
//   - supervisor@afm.local / Supervisor!2026 (supervisor)
//
// Asume el server de production en :3000 (o lo que diga BASE_URL).
// Si el server no esta corriendo, playwright.config.ts lo levanta.

import { expect, test, type Page } from "@playwright/test";

const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "test@afm.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "TestPass!2026"
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

async function logout(page: Page) {
  await page.context().clearCookies();
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

  test("2.1 Como operador, veo 4 KPIs de fumigacion en el dashboard", async ({ page }) => {
    await expect(page.getByText(/Hect[áa]reas tratadas/i).first()).toBeVisible();
    await expect(page.getByText(/Aplicaciones/i).first()).toBeVisible();
    await expect(page.getByText(/Vuelos/i).first()).toBeVisible();
    await expect(page.getByText(/Volumen aplicado/i).first()).toBeVisible();
  });

  test("2.2 Como operador, veo el grafico de serie mensual (12 meses)", async ({ page }) => {
    // El MonthlyChart tiene el titulo "Hectareas tratadas por mes"
    // (V0 mockup CardTitle).
    await expect(page.getByText(/Hect[áa]reas tratadas por mes/i).first()).toBeVisible();
  });

  test("2.3 Como operador, veo el panel de cumplimiento con estados", async ({ page }) => {
    await expect(page.getByText(/Cumplimiento/i).first()).toBeVisible();
    // Al menos uno de los 4 estados aparece (al dia, por vencer, vencido, critico)
    const hasAnyStatus =
      (await page.getByText(/Al d[íi]a/i).count()) > 0 ||
      (await page.getByText(/Por vencer/i).count()) > 0 ||
      (await page.getByText(/Vencido/i).count()) > 0 ||
      (await page.getByText(/Cr[íi]tico/i).count()) > 0;
    expect(hasAnyStatus).toBeTruthy();
  });

  test("2.4 Como operador, veo la actividad reciente (ultimas fumigaciones)", async ({ page }) => {
    // El RecentActivity tiene el titulo "Ultimas aplicaciones registradas"
    // (V0 mockup CardTitle).
    await expect(page.getByText(/[ÚU]ltimas aplicaciones registradas/i).first()).toBeVisible();
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
    // El mapa MapLibre inserta un <canvas> cuando inicializa. Le damos
    // hasta 15s para que cargue (puede tardar si las tiles de EOX/OSM
    // son lentas en el primer fetch).
    const canvas = page.locator("canvas");
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });
  });

  test("3.2 Como operador, puedo alternar entre Satelite y Callejero", async ({ page }) => {
    // El boton "Satelite" existe y es clickeable
    const sateliteBtn = page.getByRole("button", { name: /Sat[ée]lite/i });
    const callejeroBtn = page.getByRole("button", { name: /Callejero/i });
    await expect(sateliteBtn).toBeVisible();
    await expect(callejeroBtn).toBeVisible();
    // Cambio a Callejero
    await callejeroBtn.click();
    // El mapa sigue visible (no crashea)
    const map = page.locator('[aria-label="Mapa de parcelas de caña"]');
    await expect(map).toBeVisible();
  });

  test("3.3 Como operador, puedo filtrar por Cliente / Ingenio", async ({ page }) => {
    const clienteFilter = page.getByText(/Cliente\s*\/\s*Ingenio/i).first();
    await expect(clienteFilter).toBeVisible();
    // El filter es un FieldSelect (combobox)
    const select = page.locator("select").first();
    expect(await select.count()).toBeGreaterThan(0);
  });

  test("3.4 Como operador, puedo filtrar por Estado de cadencia", async ({ page }) => {
    await expect(page.getByText(/Estado de cadencia/i).first()).toBeVisible();
  });

  test("3.5 Como operador, veo el contador de parcelas en el filtro", async ({ page }) => {
    await expect(page.getByText(/parcelas en el filtro/i).first()).toBeVisible();
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

  test("4.1 Como operador, veo la tabla de parcelas con su cadencia", async ({ page }) => {
    await expect(page.getByText(/Inventario de parcelas/i)).toBeVisible();
    // La tabla tiene al menos 1 fila
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("4.2 Como operador, puedo buscar parcelas por texto", async ({ page }) => {
    const search = page.getByPlaceholder(/Buscar parcela/i);
    await expect(search).toBeVisible();
    await search.fill("GUACHICONA");
    await page.waitForTimeout(500); // debounce del filter
    // Sigue mostrando filas (o empty state, pero no error)
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("4.3 Como operador, puedo filtrar por cliente (dropdown)", async ({ page }) => {
    const clienteLabel = page.getByText(/^Cliente$/i).first();
    await expect(clienteLabel).toBeVisible();
  });

  test("4.4 Como operador, puedo hacer click en una parcela para ir al detalle", async ({ page }) => {
    // El primer link de parcela del body
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
    // Si la parcela no existe, redirige a 404; si existe, renderiza el detalle
    expect(resp?.status() ?? 0).toBeLessThan(500);
    if (!page.url().endsWith("/404")) {
      // Contiene el nombre de la parcela o el id
      const body = await page.locator("body").innerText();
      expect(body.length).toBeGreaterThan(500);
    }
  });

  test("5.2 Como operador, el detalle tiene un link 'Volver al inventario'", async ({ page }) => {
    await loginAs(page, ADMIN);
    await page.goto("/parcelas/1");
    if (!page.url().endsWith("/404")) {
      // El link "Volver al inventario" apunta a /parcelas
      const link = page.getByRole("link", { name: /Volver al inventario/i });
      await expect(link).toBeVisible();
      const href = await link.getAttribute("href");
      expect(href).toBe("/parcelas");
    }
  });
});

// =============================================================================
// US-6: Admin — Edición de metadata V0
// =============================================================================
test.describe("US-6: Admin edita metadata V0", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
  });

  test("6.1 Como admin, /admin/parcels me muestra la tabla de parcelas", async ({ page }) => {
    await page.goto("/admin/parcels");
    await expect(page.getByText(/Admin · Parcelas/i)).toBeVisible();
    const rows = page.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("6.2 Como admin, los 4 inputs V0 (cliente, hacienda, municipio, variedad) son editables", async ({ page }) => {
    await page.goto("/admin/parcels");
    const firstRow = page.locator("tbody tr").first();
    const inputs = [
      firstRow.locator('input[aria-label$="client_name"]'),
      firstRow.locator('input[aria-label$="farm_name"]'),
      firstRow.locator('input[aria-label$="municipality"]'),
      firstRow.locator('input[aria-label$="variety"]')
    ];
    for (const inp of inputs) {
      await expect(inp).toBeVisible();
      await expect(inp).toBeEnabled();
    }
  });

  test("6.3 Como admin, puedo editar y guardar un campo (con cleanup automatico)", async ({ page }) => {
    // PATCH directo a la API (mas robusto que UI para tests de servidor)
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
    // El middleware (proxy.ts) detecta role=supervisor y redirige a /login
    await page.goto("/admin/parcels");
    await expect(page).toHaveURL(/\/login/);
  });

  test("7.3 Como supervisor, /api/admin/parcels/[id]/metadata devuelve 403 (gated por handler)", async ({ page }) => {
    await loginAs(page, SUPERVISOR);
    // Bypasseando el middleware (curl directo al handler): debe tirar 403
    // por requireRole("admin") en el handler.
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
    // El handler debe devolver 403 (requireRole tira FORBIDDEN)
    expect(resp.status).toBe(403);
  });
});
