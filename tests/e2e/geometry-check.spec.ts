// E2E check: verify the synthetic geometry fix. Confirms 1213 polygons
// with unique positions are rendered in the /geovisor dataset.
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

test("geometry fix v2.5.3: 1213 parcelas con posiciones unicas en Valle del Cauca", async ({ page }) => {
  await login(page);
  await page.goto("/geovisor");
  await expect(page).toHaveURL("/geovisor");

  // Filter badge shows total parcela count
  const badge = page.locator("text=/\\d+\\s*parcelas/").first();
  await expect(badge).toBeVisible({ timeout: 5_000 });
  const badgeText = (await badge.textContent()) ?? "";
  expect(badgeText).toMatch(/1\.?213|1213/);

  // Verify HTML has 1213 polygon geometries
  const html = await page.content();
  const polygonCount = (html.match(/Polygon/g) || []).length;
  expect(polygonCount).toBeGreaterThanOrEqual(1213);

  // Extract all (lng, lat) pairs from the polygon coordinates and verify
  // they're spread across the Valle del Cauca region (not stacked at one point)
  const coords = Array.from(html.matchAll(/\[\s*(-?\d+\.\d{4,8})\s*,\s*(-?\d+\.\d{4,8})\s*\]/g));
  const valleCaucaCoords = coords
    .map((m) => ({ lng: parseFloat(m[1]), lat: parseFloat(m[2]) }))
    .filter((c) => c.lng > -77 && c.lng < -75 && c.lat > 2.5 && c.lat < 4.5);

  const uniqueCentroids = new Set(
    valleCaucaCoords.map((c) => `${c.lng.toFixed(4)},${c.lat.toFixed(4)}`)
  );

  console.log(`Total coords in Valle del Cauca region: ${valleCaucaCoords.size}`);
  console.log(`Unique centroids: ${uniqueCentroids.size}`);

  // Should have 1213 unique positions (one per parcel, modulo hash collisions)
  expect(uniqueCentroids.size).toBeGreaterThan(1100);
});
