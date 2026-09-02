// scripts/screenshot-login-clean.mjs
// Captura el login page sin AppShell para verificar el fix S10.4

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = join(__dirname, "..", "docs", "qa-screenshots-2026-08-22");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT_DIR, "20-login-clean.png"), fullPage: false });
console.log("OK: 20-login-clean.png");

await page.fill("input[name=email]", "admin@aeroadmin.local");
await page.fill("input[name=password]", "AFM-admin-2026!");
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT_DIR, "21-login-clean-filled.png"), fullPage: false });
console.log("OK: 21-login-clean-filled.png");

// Click via role para evitar el primer button[type=submit]
await page.getByRole("button", { name: /ingresar/i }).click();
try {
  await page.waitForURL("http://localhost:3000/", { timeout: 15000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT_DIR, "22-after-login-clean.png"), fullPage: false });
  console.log("OK: 22-after-login-clean.png (dashboard con AppShell, login sin)");
} catch (e) {
  console.log("ERR navegando:", e.message);
  await page.screenshot({ path: join(OUT_DIR, "22-login-error.png") });
}

await browser.close();
