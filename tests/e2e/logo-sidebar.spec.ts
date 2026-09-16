import { test, expect, type Page } from "@playwright/test"

/**
 * Verifica que el emblema de marca AFM se ve en el sidebar izquierdo.
 *
 * 2026-09-15: el sidebar usa `/afm-emblem.svg` (recorte del círculo
 * amarillo del logo original de AFM Topografía) vía
 * `<AfmMark variant="emblem" />`. Los assets previos
 * (`/afm-logo-mark.svg`, `/afm-logo.svg`) fueron reemplazados por el
 * emblema y el logo completo fieles al original.
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
  await page.goto("/geovisor")
  await page.waitForTimeout(3000)

  const logo = page.locator('img[src="/afm-emblem.svg"]')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute("alt", /AFM/i)

  const sidebar = page.locator("aside").first()
  await expect(sidebar.locator('img[src="/afm-emblem.svg"]')).toBeVisible()
  await expect(sidebar.getByRole("navigation")).toBeVisible()

  await page.screenshot({ path: "test-results/logo-sidebar-v3.png", fullPage: false })
})
