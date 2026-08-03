import { test, expect, type Page } from "@playwright/test"

/**
 * S8.8 v2.7.1 — Verifica SOLO que el logo AFM se ve en el sidebar izquierdo
 * (no en el Filtros panel). Login + screenshot.
 */
const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "e2e@aeroadmin.local"
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "E2ETest12345!"

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[name="email"]', E2E_EMAIL)
  await page.fill('input[name="password"]', E2E_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30_000 })
}

test("logo AFM visible en sidebar izquierdo del app shell", async ({ page }) => {
  await login(page)
  // Estamos en /dashboard (o /). Vamos directo al geovisor para ver el sidebar.
  await page.goto("/geovisor")
  await page.waitForTimeout(3000)

  // El logo AFM debe estar visible (es el unico en la pagina)
  const logo = page.locator('img[src="/afm-logo.svg"]')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute("alt", /Logo AFM/i)

  // El logo debe estar en el sidebar IZQUIERDO (etiqueta "Navegación principal"
  // cerca). Confirmamos que el sidebar contiene tanto el logo como la nav.
  const sidebar = page.locator("aside").first()
  await expect(sidebar.locator('img[src="/afm-logo.svg"]')).toBeVisible()
  await expect(sidebar.getByRole("navigation")).toBeVisible()

  await page.screenshot({ path: "test-results/logo-sidebar-v2.7.1.png", fullPage: false })
})
