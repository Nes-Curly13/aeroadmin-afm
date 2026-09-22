// E2E Playwright — Geovisor + Parcelas.
//
// Actualizado 2026-09-21: el geovisor pasó a un **Inspector unificado**
// (Contexto / Parcelas / Fumigaciones) y el mapa ya no abre popups. Los
// filtros de cadencia/cliente/hacienda/drone/source no existen (QA-02).
//
// Cobertura:
//   1. /geovisor carga tras login y muestra el mapa + el Inspector
//   2. /geovisor: toggle de Mapa base (Satélite / Calles)
//   3. /geovisor: rail de filtros (búsqueda + rango + capas + leyenda)
//   4. /geovisor: cambiar a Calles no rompe
//   5. /parcelas: tabla de parcelas
//   6. /parcelas: filtro de búsqueda
//   7. /parcelas/[id]: ficha de parcela #1

import { expect, test, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15_000 });
}

test.describe("Geovisor (Inspector unificado)", () => {
  test("1. /geovisor carga y muestra el mapa + Inspector", async ({ page }) => {
    await login(page);
    await page.goto("/geovisor");
    await expect(page).toHaveURL("/geovisor");
    await expect(page.locator('[aria-label="Mapa de parcelas de caña"]')).toBeVisible();
    await expect(page.getByTestId("geovisor-inspector")).toBeVisible();
    // El mapa ya no muestra popups: el detalle vive en el Inspector.
    await expect(page.getByTestId("inspector-tab-contexto")).toBeVisible();
    await expect(page.getByTestId("inspector-tab-parcelas")).toBeVisible();
    await expect(page.getByTestId("inspector-tab-fumigaciones")).toBeVisible();
  });

  test("2. /geovisor: toggle de Mapa base (Satélite / Calles)", async ({ page }) => {
    await login(page);
    await page.goto("/geovisor");
    const legend = page.locator("legend", { hasText: /Mapa base/i });
    await expect(legend).toBeVisible();
    const fieldset = legend.locator("..");
    await expect(fieldset.getByText("Satélite")).toBeVisible();
    await expect(fieldset.getByText("Calles")).toBeVisible();
  });

  test("3. /geovisor: rail de filtros (búsqueda, rango, capas, leyenda)", async ({ page }) => {
    await login(page);
    await page.goto("/geovisor");
    await expect(page.getByTestId("geovisor-search")).toBeVisible();
    await expect(page.getByTestId("geovisor-from")).toBeVisible();
    await expect(page.getByTestId("geovisor-to")).toBeVisible();
    await expect(page.getByText(/Pol[íi]gonos de parcelas/i).first()).toBeVisible();
    await expect(page.getByText(/Aplicaciones en el rango/i).first()).toBeVisible();
    await expect(page.getByText(/Leyenda/i).first()).toBeVisible();
  });

  test("4. /geovisor: cambiar a Calles no rompe", async ({ page }) => {
    await login(page);
    await page.goto("/geovisor");
    const calles = page.getByRole("button", { name: /^Calles$/ });
    await expect(calles).toBeVisible();
    await calles.click();
    await expect(page.locator('[aria-label="Mapa de parcelas de caña"]')).toBeVisible();
  });

  test("5. /geovisor: seleccionar una parcela abre su contexto en el Inspector", async ({ page }) => {
    await login(page);
    await page.goto("/geovisor");
    await page.getByTestId("inspector-tab-parcelas").click();
    const firstParcel = page.locator('[data-testid^="geovisor-parcel-"]').first();
    await expect(firstParcel).toBeVisible();
    await firstParcel.click();
    await expect(page.getByTestId("inspector-parcel-summary")).toBeVisible();
  });
});

test.describe("Parcelas", () => {
  test("6. /parcelas: tabla de parcelas renderiza", async ({ page }) => {
    await login(page);
    await page.goto("/parcelas");
    await expect(page).toHaveURL("/parcelas");
    await expect(page.getByText(/Inventario de parcelas/i)).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
  });

  test("7. /parcelas: filtro de búsqueda no rompe", async ({ page }) => {
    await login(page);
    await page.goto("/parcelas");
    const search = page.getByPlaceholder(/Buscar parcela/i);
    await expect(search).toBeVisible();
    await search.fill("ste");
    await page.waitForTimeout(500);
    expect(await page.locator("tbody tr").count()).toBeGreaterThan(0);
  });

  test("8. /parcelas/[id]: ficha de parcela #1 renderiza sin 500", async ({ page }) => {
    await login(page);
    await page.goto("/parcelas/1");
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(300);
  });
});
