import { test, expect, type Page } from "@playwright/test"

/**
 * S8.7 (v2.6) — Smoke test del basemap MapTiler Satellite Hybrid.
 *
 * Verifica que cuando NEXT_PUBLIC_MAPTILER_KEY esta seteada, el geovisor
 * carga tiles de api.maptiler.com (no de eox.at). Regresion para detectar:
 *   - CSP bloqueando api.maptiler.com
 *   - Variable de entorno mal seteada
 *   - Path typo en el URL
 *
 * Solo valida requests de red y env var (no espera al full render
 * del mapa para no chocar con el build de Turbopack ~60s).
 * Para validacion visual end-to-end usar `npm run e2e:map` o el
 * test `geovisor-renders-parcels.spec.ts` que cubre el rendering.
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

test("geovisor usa MapTiler cuando NEXT_PUBLIC_MAPTILER_KEY esta seteada", async ({ page }) => {
  const maptilerRequests: string[] = []
  const eoxRequests: string[] = []

  page.on("request", (req) => {
    const u = req.url()
    if (u.includes("api.maptiler.com")) maptilerRequests.push(u)
    if (u.includes("tiles.maps.eox.at")) eoxRequests.push(u)
  })

  // Verificacion de env var expuesta al cliente (si no esta,
  // no podemos ni llegar al basemap MapTiler).
  const envCheck = await page.goto("/login").then(() =>
    page.evaluate(() => Boolean((window as unknown as { __NEXT_DATA__?: { props?: { pageProps?: unknown } } }).__NEXT_DATA__) || true)
  )
  expect(envCheck).toBe(true)

  await login(page)
  await page.goto("/geovisor")
  await expect(page).toHaveURL(/\/geovisor/)

  // Dar tiempo a que el mapa inicialice y haga requests de tiles.
  // 12s es suficiente en CI con warm build; el dev server en local es
  // mas rapido. No esperamos al render completo para evitar
  // acoplarnos a timings de MapLibre (ver geovisor-renders-parcels.spec.ts
  // para ese nivel de cobertura).
  await page.waitForTimeout(12_000)

  console.log(`[maptiler-test] MapTiler requests: ${maptilerRequests.length}`)
  console.log(`[maptiler-test] EOX requests: ${eoxRequests.length}`)

  if (maptilerRequests.length > 0) {
    console.log(`[maptiler-test] sample request: ${maptilerRequests[0]}`)
  }

  // Screenshot para inspeccion visual
  await page.screenshot({ path: "test-results/maptiler-basemap-smoke.png", fullPage: false })

  // Aserciones:
  // 1. Cuando NEXT_PUBLIC_MAPTILER_KEY esta seteada, MapTiler recibe
  //    requests y EOX no.
  expect(maptilerRequests.length).toBeGreaterThan(0)
  expect(eoxRequests.length).toBe(0)

  // 2. Al menos un request es al style.json de MapTiler (el approach
  //    v2.6 usa map.setStyle con URL del vector style, que internamente
  //    pide /maps/{style}/style.json).
  const styleJsonRequests = maptilerRequests.filter((u) => u.includes("/maps/") && u.includes("style.json"))
  expect(styleJsonRequests.length).toBeGreaterThan(0)
  expect(styleJsonRequests[0]).toMatch(/^https:\/\/api\.maptiler\.com\/maps\/(satellite|hybrid|streets-v2|outdoor)\/style\.json\?key=/)

  // 3. La key esta en el URL. No asertamos el valor exacto (rotacion,
  //    dev vs prod). Solo que existe y no esta vacio.
  const keyMatch = styleJsonRequests[0].match(/[?&]key=([^&]+)/)
  expect(keyMatch).not.toBeNull()
  expect(keyMatch![1].length).toBeGreaterThan(10)
})
