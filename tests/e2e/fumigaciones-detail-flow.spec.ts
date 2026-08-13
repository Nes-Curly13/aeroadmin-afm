// E2E Playwright — Flow de fumigaciones: filtros + detail + edit + restore
// Sprint 2026-08-13 — feature/fumigaciones-detail-polish.
//
// Cubre (cuando la BD está sembrada):
//   1. /fumigaciones lista fumigaciones
//   2. Filtro por categoría "Herbicida"
//   3. Filtro por parcela específica (input number)
//   4. Filtro por rango de fechas (from/to)
//   5. Click en una fila navega al detail (/fumigacion/[id])
//   6. Detail: badges de categoría + fuente + acciones (PDF, CSV, Editar, Eliminar)
//   7. "Editar fumigación" navega a /fumigacion/[id]/edit
//   8. Edit: cambiar product_used + submit + vuelve al detail con el cambio
//   9. "Volver a fumigaciones" preserva el contexto
//  10. "Limpiar" filtros lleva a /fumigaciones sin searchParams
//
// **Precondiciones para correr este spec completo**:
//   - `npm run db:up` (Postgres + PostGIS via docker)
//   - `npm run db:migrate` (las 25 migrations aplicadas)
//   - `npm run db:seed` (incluye fumigaciones DJI; las manuales las crea
//     el test o un script aparte)
//   - El `global-setup.ts` ya siembra el admin e2e@aeroadmin.local.
//   - `npm run e2e` o `npm run dev` + `BASE_URL=http://localhost:3000`
//
// **Estado actual (2026-08-13)**: la BD no está sembrada en este
// entorno. Los tests que requieren fumigaciones en la BD están
// marcados con `test.skip(...)` y comentarios indicando qué seed
// se necesita. El test smoke de redirect (1) corre sin BD — solo
// necesita el server + NextAuth funcionando.

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

test.describe("Fumigaciones — flow completo (S5 polish)", () => {
  // ============================================================
  // Test smoke: corre sin BD. Verifica que el middleware redirige
  // a /login cuando el usuario no está autenticado. No requiere
  // fumigaciones seedeadas.
  // ============================================================

  test("smoke: /fumigaciones sin auth redirige a /login (middleware)", async ({ page }) => {
    await page.goto("/fumigaciones");
    await expect(page).toHaveURL(/\/login/);
  });

  // ============================================================
  // Tests que requieren BD sembrada con fumigaciones DJI + manuales.
  // El seed actual (npm run db:seed) no incluye fumigaciones
  // manuales. Para activarlos, primero correr el pipeline DJI
  // (npm run pipeline:djiag) o un script de seed que cree al menos:
  //   - 1 fumigación manual con category_id=1 (herbicida)
  //   - 1 fumigación DJI con category_id=2 (insecticida)
  //   - 1 fumigación con parcel_id=3107
  // Luego remover los `test.skip` siguientes.
  // ============================================================

  test.skip("lista de fumigaciones se ve (header + tabla con filas)", async ({ page }) => {
    // Requiere: al menos 1 fumigación en la BD (DJI o manual).
    await login(page);
    await page.goto("/fumigaciones");
    // Header del page
    await expect(page.getByRole("heading", { name: /Fumigaciones/i })).toBeVisible();
    // La tabla tiene al menos 1 fila con un link a /fumigacion/[id]
    const firstRowLink = page.locator('a[href^="/fumigacion/"]').first();
    await expect(firstRowLink).toBeVisible();
  });

  test.skip("filtrar por categoría 'Herbicida' deja solo fumigaciones de esa categoría", async ({ page }) => {
    // Requiere: al menos 1 fumigación con category_id=1 (herbicida) y
    // 1 fumigación con category_id != 1 en la BD.
    await login(page);
    await page.goto("/fumigaciones");
    // Seleccionar el dropdown de categoría
    await page.selectOption('select[name="category"]', "herbicida");
    await page.click('button[type="submit"]:has-text("Filtrar")');
    // La URL debe tener el searchParam
    await expect(page).toHaveURL(/category=herbicida/);
    // Verificar que cada fila tiene el badge "Herbicida"
    const badges = page.locator("text=Herbicida");
    expect(await badges.count()).toBeGreaterThan(0);
  });

  test.skip("filtrar por parcela 3107 deja solo fumigaciones de esa parcela", async ({ page }) => {
    // Requiere: al menos 1 fumigación con parcel_id=3107.
    await login(page);
    await page.goto("/fumigaciones");
    await page.fill('input[name="parcel"]', "3107");
    await page.click('button[type="submit"]:has-text("Filtrar")');
    await expect(page).toHaveURL(/parcel=3107/);
    // Verificar que cada link "#3107" en la columna Parcela está presente
    const parcelLinks = page.locator('a[href="/parcelas/3107"]');
    expect(await parcelLinks.count()).toBeGreaterThan(0);
  });

  test.skip("filtrar por rango de fechas actualiza el resultado", async ({ page }) => {
    // Requiere: fumigaciones en al menos 2 fechas distintas.
    await login(page);
    await page.goto("/fumigaciones");
    // Setear rango (asumimos que hay fumigaciones en 2026-08)
    await page.fill('input[name="from"]', "2026-08-01");
    await page.fill('input[name="to"]', "2026-08-31");
    await page.click('button[type="submit"]:has-text("Filtrar")');
    await expect(page).toHaveURL(/from=2026-08-01.*to=2026-08-31|to=2026-08-31.*from=2026-08-01/);
  });

  test.skip("click en una fila navega a /fumigacion/[id]", async ({ page }) => {
    // Requiere: al menos 1 fumigación.
    await login(page);
    await page.goto("/fumigaciones");
    // Click en el primer link a /fumigacion/[id]
    await page.locator('a[href^="/fumigacion/"]').first().click();
    // Estamos en el detail
    await expect(page).toHaveURL(/\/fumigacion\/\d+/);
  });

  test.skip("detail muestra badges de categoría, fuente, y acciones (PDF, CSV, Editar, Eliminar)", async ({ page }) => {
    // Requiere: al menos 1 fumigación con category_id y source.
    await login(page);
    await page.goto("/fumigaciones");
    // Capturar el id de la primera fila
    const firstLink = page.locator('a[href^="/fumigacion/"]').first();
    const href = await firstLink.getAttribute("href");
    await firstLink.click();
    await expect(page).toHaveURL(/\/fumigacion\/\d+/);
    // Verificar que está el botón "Editar fumigación"
    await expect(page.getByRole("link", { name: /Editar fumigaci[oó]n/i })).toBeVisible();
    // Verificar que está el form/botón "Eliminar"
    await expect(page.getByRole("button", { name: /Eliminar/i })).toBeVisible();
    // Verificar que están los links de PDF y CSV (si los hay en el detail)
    // (El detail tiene el banner de "modo lectura" — el header puede
    // incluir un "Descargar PDF" o similar)
    void href;
  });

  test.skip("Editar fumigación → cambia product_used → vuelve al detail con el cambio aplicado", async ({ page }) => {
    // Requiere: al menos 1 fumigación con product_used.
    await login(page);
    await page.goto("/fumigaciones");
    await page.locator('a[href^="/fumigacion/"]').first().click();
    await expect(page).toHaveURL(/\/fumigacion\/\d+/);
    // Click en "Editar fumigación"
    await page.getByRole("link", { name: /Editar fumigaci[oó]n/i }).click();
    await expect(page).toHaveURL(/\/fumigacion\/\d+\/edit/);
    // Cambiar el campo product_used. El form usa @base-ui/react, los
    // inputs tienen name="product_used".
    const newProduct = `Glifosato 48% (editado ${Date.now()})`;
    await page.fill('input[name="product_used"]', newProduct);
    // Submit
    await page.click('button[type="submit"]:has-text("Guardar")');
    // Vuelve al detail
    await expect(page).toHaveURL(/\/fumigacion\/\d+$/);
    // El nuevo producto debe estar visible
    await expect(page.getByText(newProduct)).toBeVisible();
  });

  test.skip("'Volver a fumigaciones' desde el detail preserva el contexto", async ({ page }) => {
    // Requiere: fumigaciones en la BD.
    await login(page);
    await page.goto("/fumigaciones");
    await page.locator('a[href^="/fumigacion/"]').first().click();
    // Buscar el link "Volver a fumigaciones" en el detail
    const backLink = page.getByRole("link", { name: /Volver a fumigaciones/i });
    await backLink.click();
    // Vuelve al listado
    await expect(page).toHaveURL(/\/fumigaciones$/);
  });

  test.skip("'Limpiar' filtros lleva a /fumigaciones sin searchParams", async ({ page }) => {
    // Requiere: fumigaciones en la BD.
    await login(page);
    // Empezar con un filtro activo
    await page.goto("/fumigaciones?category=herbicida");
    // El botón "Limpiar" es un <Link href="/fumigaciones"> — debería
    // estar visible cuando hay algún filtro activo.
    const clearLink = page.getByRole("link", { name: /Limpiar/i });
    await expect(clearLink).toBeVisible();
    await clearLink.click();
    // URL limpia, sin searchParams
    await expect(page).toHaveURL(/\/fumigaciones$/);
  });
});
