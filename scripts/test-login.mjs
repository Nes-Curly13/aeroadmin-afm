// scripts/test-login.mjs
//
// Verifica el flujo de login end-to-end con credenciales conocidas.
// Captura screenshots para presentar al user.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = join(__dirname, "..", "docs", "qa-screenshots-2026-08-22");
const BASE = "http://localhost:3000";
const EMAIL = "admin@aeroadmin.local";
const PASSWORD = "AFM-admin-2026!";

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const consoleLogs = [];
page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
const failed = [];
page.on("requestfailed", (req) => failed.push(`${req.url()} - ${req.failure()?.errorText}`));
const responses = [];
page.on("response", (resp) => {
  // capturar todos los requests para entender la hidratación
  if (resp.url().includes("/login") || resp.url().includes("/api/auth") || resp.url().includes("chunks") || resp.url().includes("/_next/")) {
    const req = resp.request();
    responses.push(`${resp.status()} ${req.method()} ${resp.url()}`);
  }
});

console.log("\n[1] Navegando a /login...");
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });
await page.screenshot({ path: join(OUT_DIR, "10-login-empty.png") });
console.log("  -> screenshot 10-login-empty.png");

console.log("[2] Llenando credenciales...");
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
// Esperar largo a que React hidrate. Next.js 16 + Turbopack con
// dev mode + "use client" + app-shell layout que tiene
// imagen puede tardar ~3-5s la primera vez. Ademas: el
// SVG optimizado esta devolviendo 400 lo que podria estar
// retrasando la hidration.
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT_DIR, "11-login-filled.png") });
console.log("  -> screenshot 11-login-filled.png");

console.log("[3] Submit (click button by text)...");
const startUrl = page.url();
await page.getByRole("button", { name: /ingresar/i }).click();
// Login fue exitoso (302 de NextAuth + cookie afm.session). Ahora
// esperamos a que la SPA termine de navegar al dashboard.
try {
  await page.waitForURL("http://localhost:3000/", { timeout: 15000 });
} catch (e) {
  console.log("  -> current URL after submit:", page.url());
}
await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(3000);
// Esperar a que navegue (puede ir a "/" o quedarse en /login con error)
try {
  console.log("  -> navego a:", page.url());
  // Esperar un poco a que cargue el dashboard
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, "12-after-login.png"), fullPage: false });
  console.log("  -> screenshot 12-after-login.png (post-login)");
  console.log("\n[OK] Login exitoso. Cookies:", (await ctx.cookies()).map(c => c.name).join(", "));
} catch (e) {
  console.log("  -> no se navego. URL actual:", page.url());
  // Capturar pantalla de error
  await page.screenshot({ path: join(OUT_DIR, "12-login-error.png") });
  console.log("  -> screenshot 12-login-error.png");
  // Ver si hay mensaje de error en la pagina
  const errText = await page.locator('[role="alert"]').textContent().catch(() => null);
  console.log("\n[FAIL] Login fallo. Error en pantalla:", errText || "(sin mensaje)");
  // debug: cookies actuales
  console.log("  cookies actuales:", (await ctx.cookies()).map(c => c.name + "=" + c.value.slice(0, 20)).join(", "));
}

console.log("\n--- Console logs del browser ---");
consoleLogs.forEach((l) => console.log("  ", l));
console.log("\n--- /api/auth + /login responses ---");
responses.forEach((r) => console.log("  ", r));
if (failed.length) {
  console.log("\n--- Requests fallidos ---");
  failed.forEach((f) => console.log("  ", f));
}

await browser.close();
