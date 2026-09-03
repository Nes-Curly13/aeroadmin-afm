// scripts/debug-login.mjs
// Debug del form submit

import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[browser]", m.type(), m.text()));
page.on("request", (r) => {
  if (r.url().includes("/api/auth") || r.url().includes("/login")) {
    console.log("[request]", r.method(), r.url().slice(0, 80));
  }
});
await page.goto("http://localhost:3000/login", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

await page.fill("input[name=email]", "admin@aeroadmin.local");
await page.fill("input[name=password]", "AFM-admin-2026!");
await page.waitForTimeout(1000);

const debug = await page.evaluate(() => {
  const f = document.querySelector("form");
  if (!f) return { hasForm: false };
  const keys = Object.keys(f);
  const reactKey = keys.find((k) => k.startsWith("__reactProps"));
  const reactProps = reactKey ? Object.keys(f[reactKey] || {}) : [];
  return {
    hasForm: true,
    hasReactProps: !!reactKey,
    reactPropKeys: reactProps,
    onSubmitType: typeof f[reactKey]?.onSubmit,
  };
});
console.log("[debug] form:", JSON.stringify(debug, null, 2));

console.log("[debug] dispatching submit event...");
await page.evaluate(() => {
  const f = document.querySelector("form");
  if (f) {
    f.dispatchEvent(new SubmitEvent("submit", { cancelable: true, bubbles: true }));
  }
});
await page.waitForTimeout(10000);
console.log("[debug] final URL:", page.url());
await browser.close();
