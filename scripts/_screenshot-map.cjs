// Screenshot del /map rediseñado (v1.8) en local.
// Uso: node scripts/_screenshot-map.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.resolve(__dirname, "..", "screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();

  console.log("[1/5] Login en /login");
  await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', "admin@aeroadmin.local");
  await page.fill('input[name="password"]', "TestScreenshot2026!");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]')
  ]);
  console.log("  -> url:", page.url());

  console.log("[2/5] Navegar a /map");
  await page.goto("http://localhost:3000/map", { waitUntil: "domcontentloaded" });
  // Esperar a que el mapa cargue (los tiles satelitales demoran ~2-5s)
  await page.waitForSelector('[data-testid="map-page-header"]', { timeout: 30000 });
  await page.waitForSelector('.leaflet-tile-loaded', { timeout: 60000 }).catch(() => {
    console.log("  (sin tiles cargados en 60s, screenshot igual)");
  });
  await page.waitForTimeout(3000); // dejar asentar labels y tiles

  // Screenshot 1: drawer CERRADO (estado inicial)
  const closed = path.join(OUT_DIR, "map-v1-8-collapsed.png");
  await page.screenshot({ path: closed, fullPage: false });
  console.log("[3/5] Screenshot drawer cerrado:", closed);

  // Screenshot 2: drawer ABIERTO
  await page.click('[data-testid="map-page-header-filters-button"]');
  await page.waitForSelector('[data-testid="map-filter-drawer"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  const open = path.join(OUT_DIR, "map-v1-8-open.png");
  await page.screenshot({ path: open, fullPage: false });
  console.log("[4/5] Screenshot drawer abierto:", open);

  // Screenshot 3: full page (con scroll del sidebar)
  await page.screenshot({ path: path.join(OUT_DIR, "map-v1-8-fullpage.png"), fullPage: true });
  console.log("[5/5] Screenshot fullPage");

  // Console errors
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });

  await browser.close();
  if (errors.length > 0) {
    console.log("\nERRORES en consola del browser:");
    for (const e of errors) console.log("  -", e);
  } else {
    console.log("\nSin errores de consola.");
  }
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
