// E2E regression test: /geovisor renderiza los 1213 polígonos en el canvas.
//
// Sprint S8.6 (v2.5.4) — fix del rendering de MapLibre. El patron
// "addSource con data inline" + MapLibre 6.0 + Next.js 16 + CSP
// restringida dejaba al worker de GeoJSON zombie (_isUpdatingWorker=true
// para siempre, querySourceFeatures=0). El fix:
//   1. Downgrade a MapLibre 4.7.1 (UMD + worker compatible)
//   2. CSP con `worker-src 'self' blob:` y `child-src 'self' blob:`
//      para que el Web Worker de geojson-vt pueda cargar
//
// Si alguien revierte el downgrade o rompe la CSP, este test detecta
// que el source no termina de cargar (isSourceLoaded=false permanente
// + querySourceFeatures=0 + queryRenderedFeatures=0).
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

test("/geovisor renderiza los 1213 polígonos sintéticos", async ({ page }) => {
  await login(page);
  await page.goto("/geovisor");
  await expect(page).toHaveURL(/\/geovisor/);

  // Espera a que el worker de MapLibre tile-e los 1213 polígonos.
  // El basemap carga en ~2s pero el worker de geojson-vt puede
  // tardar 10-15s con datasets grandes en CI.
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __afmMap?: { queryRenderedFeatures: (opts?: unknown, o?: { layers?: string[] }) => Array<unknown> } }).__afmMap;
      if (!m) return false;
      try {
        return m.queryRenderedFeatures(undefined, { layers: ["parcels-fill"] }).length > 0;
      } catch {
        return false;
      }
    },
    { timeout: 30_000 }
  );

  // Estado final del mapa
  const state = await page.evaluate(() => {
    const m = (window as unknown as {
      __afmMap?: {
        isStyleLoaded: () => boolean;
        isSourceLoaded: (id: string) => boolean;
        querySourceFeatures: (id: string) => unknown[];
        queryRenderedFeatures: (opts?: unknown, o?: { layers?: string[] }) => unknown[];
        getLayer: (id: string) => unknown;
        getSource: (id: string) => unknown;
      };
    }).__afmMap;
    if (!m) return { ok: false, reason: "no map" };
    return {
      ok: true,
      isStyleLoaded: m.isStyleLoaded(),
      parcelsSourceLoaded: m.isSourceLoaded("parcels"),
      querySourceFeatures: m.querySourceFeatures("parcels").length,
      queryRenderedFeatures: m.queryRenderedFeatures(undefined, { layers: ["parcels-fill"] }).length,
      hasParcelsLayer: !!m.getLayer("parcels-fill"),
      hasParcelsSource: !!m.getSource("parcels"),
    };
  });

  // Tambien verificamos que la geometria sintetica esta en el HTML
  // (asi tenemos 2 senales: server-side data + client-side rendering).
  const html = await page.content();
  const polygonCount = (html.match(/Polygon/g) || []).length;
  expect(polygonCount).toBeGreaterThanOrEqual(1213);

  // El HTML debe contener coordenadas en el bounding box del Valle
  const coordMatches = Array.from(html.matchAll(/\[\s*(-?\d+\.\d{4,8})\s*,\s*(-?\d+\.\d{4,8})\s*\]/g));
  const valleCaucaCoords = coordMatches
    .map((m) => ({ lng: parseFloat(m[1]), lat: parseFloat(m[2]) }))
    .filter((c) => c.lng > -77 && c.lng < -75 && c.lat > 2.5 && c.lat < 4.5);
  expect(valleCaucaCoords.length).toBeGreaterThan(1000);

  // El mapa debe tener los poligonos visibles
  expect(state.ok).toBe(true);
  expect(state.isStyleLoaded).toBe(true);
  expect(state.parcelsSourceLoaded).toBe(true);
  expect(state.querySourceFeatures).toBeGreaterThan(1000);
  expect(state.queryRenderedFeatures).toBeGreaterThan(0);

  // Screenshot para tener referencia visual
  await page.screenshot({ path: "tmp-geovisor-rendering.png", fullPage: false });
});
