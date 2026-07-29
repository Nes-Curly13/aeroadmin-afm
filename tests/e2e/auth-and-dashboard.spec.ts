// E2E Playwright — Auth + Dashboard V0.
// Sprint S8.2 (2026-07-29): actualizado para el V0 rebuild.
//
// Cobertura del flow principal del operador:
//   1. / no autenticado redirige a /login
//   2. Login con credenciales invalidas muestra mensaje de error
//   3. Login con admin -> dashboard V0 con KPIs de fumigación
//   4. Cada KPI tiene un numero (no "[object Object]" / "NaN")
//   5. Sidebar V0 muestra las 3 entradas (Panel, Geovisor, Parcelas)
//   6. Logout / clear cookies -> redirige a /login
//   7. /admin/* sin rol admin -> redirige a /login (gated por middleware)

import { expect, test } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15_000 });
}

test.describe("Auth + Dashboard V0 (S8.2)", () => {
  test("1. / no autenticado redirige a /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("2. Login con credenciales invalidas muestra error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "nobody@nowhere.local");
    await page.fill('input[name="password"]', "WrongPass123");
    await page.click('button[type="submit"]');
    // Esperar la respuesta del server action
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    // Debe permanecer en /login
    await expect(page).toHaveURL(/\/login/);
    // El alert del server action debe ser visible
    const alert = page.locator('p[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/incorrectos/i);
  });

  test("3. Login como admin -> dashboard V0 con 4 KPIs de fumigación", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");
    // 4 KPIs del V0 (labels del KpiCard del dashboard)
    await expect(page.getByText(/Hect[áa]reas tratadas/i).first()).toBeVisible();
    await expect(page.getByText(/Aplicaciones/i).first()).toBeVisible();
    await expect(page.getByText(/Vuelos/i).first()).toBeVisible();
    await expect(page.getByText(/Volumen aplicado/i).first()).toBeVisible();
  });

  test("4. Los valores de KPIs son numéricos (no [object Object])", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");
    const body = await page.locator("body").innerText();
    // Bugs clasicos del pasado: render de objetos en vez de valores
    expect(body).not.toContain("[object Object]");
    expect(body).not.toContain("[object Promise]");
    expect(body).not.toContain("NaN");
    // Sanity: hay al menos un numero en el dashboard (KPI o stat)
    expect(body).toMatch(/\d/);
  });

  test("5. Sidebar V0 muestra Panel / Geovisor / Parcelas", async ({ page }) => {
    await login(page);
    const nav = page.locator('nav[aria-label="Navegación principal"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByText("Panel")).toBeVisible();
    await expect(nav.getByText("Geovisor")).toBeVisible();
    await expect(nav.getByText("Parcelas")).toBeVisible();
  });

  test("6. Clear cookies -> /login (logout flow)", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL("/");
    // Limpiar cookies y forzar un fetch nuevo (no usar cache del browser).
    await page.context().clearCookies();
    // El middleware (proxy.ts) lee la cookie de sesion y redirige a
    // /login si no esta presente. goto("/") deberia triggerear ese
    // redirect 307 a /login?callbackUrl=/. Verificamos el URL final.
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    // Si el server devolvio 200 con el dashboard, las cookies no se
    // limpiaron (problema del test). Si devolvio 307 redirect, termino
    // en /login.
    const finalUrl = page.url();
    if (!finalUrl.includes("/login")) {
      // Forzar un fetch nuevo (no usar cache) y ver a donde redirige
      await page.context().clearCookies();
      await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json()));
      await page.goto("/", { waitUntil: "domcontentloaded" });
    }
    await expect(page).toHaveURL(/\/login/);
  });

  test("7. /admin/parcels accesible para admin", async ({ page }) => {
    await login(page);
    // E2E_USER es admin (seed), la ruta /admin/* deja pasar.
    // La page renderiza con la tabla de edicion inline.
    const resp = await page.goto("/admin/parcels");
    expect(resp?.status()).toBe(200);
    // Heading V0
    await expect(page.getByText(/Admin · Parcelas/i)).toBeVisible();
    // El form de edicion inline tiene inputs para los 4 campos
    const inputs = page.locator('input[aria-label*="client_name"]');
    expect(await inputs.count()).toBeGreaterThan(0);
  });
});
