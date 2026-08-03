import { test, expect, type Page } from "@playwright/test"

/**
 * S8.8 — Verifica los cambios de UI en el geovisor:
 *   1. Logo AFM en el sidebar IZQUIERDO (app shell) — NO en Filtros
 *   2. Sin VENTANA TEMPORAL (slider de tiempo)
 *   3. CAPAS tiene simbologia visible (cuadrado rojo, circulo amarillo, glyph "Aa")
 *   4. Sidebar de filtros se sigue renderizando
 */
const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local"
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[name="email"]', E2E_EMAIL)
  await page.fill('input[name="password"]', E2E_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15_000 })
}

test("geovisor UI v8.8: logo en sidebar izquierdo + sin ventana temporal + simbologia en CAPAS", async ({ page }) => {
  await login(page)
  await page.goto("/geovisor")
  await expect(page).toHaveURL(/\/geovisor/)
  await page.waitForTimeout(5000)

  // 1. Logo AFM en sidebar IZQUIERDO (app shell). Buscamos el <img> con
  //    src que apunte a /afm-logo.svg. El link al dashboard lo envuelve.
  const logo = page.locator('img[src="/afm-logo.svg"]')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute("alt", /Logo AFM/i)

  // 2. NO debe haber "Ventana temporal" en ningun lado
  await expect(page.getByText(/ventana temporal/i)).toHaveCount(0)

  // 3. CAPAS debe tener los 3 toggles
  const parcelasLayer = page.getByRole("button", { name: /Pol.gonos de parcelas/i })
  const appsLayer = page.getByRole("button", { name: /Aplicaciones en el rango/i })
  const labelsLayer = page.getByRole("button", { name: /Etiquetas de suerte/i })
  await expect(parcelasLayer).toBeVisible()
  await expect(appsLayer).toBeVisible()
  await expect(labelsLayer).toBeVisible()

  // 4. La simbologia debe estar dentro de cada layer button
  const parcelasSym = parcelasLayer.locator("span[aria-hidden]").first()
  const appsSym = appsLayer.locator("span[aria-hidden]").first()
  const labelsSym = labelsLayer.locator("span[aria-hidden]").first()
  await expect(parcelasSym).toBeVisible()
  await expect(appsSym).toBeVisible()
  await expect(labelsSym).toBeVisible()
  await expect(labelsSym).toHaveText("Aa")

  // 5. Sidebar de filtros: titulo "Filtros" presente
  await expect(page.getByRole("heading", { name: "Filtros" })).toBeVisible()

  // Screenshot para inspeccion visual
  await page.screenshot({ path: "test-results/geovisor-ui-v88.png", fullPage: false })
})
