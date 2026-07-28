// E2E básico del sprint S5 — valida que el dev server sirve el /login
// y que el dev experience (sin auth) responde OK después de la migración
// Leaflet → MapLibre. No requiere DB: solo verifica que Next.js compila
// y sirve las páginas sin errores de runtime.
//
// Para E2E completo con auth se necesita Supabase arriba + credenciales.
// Eso se valida en el flujo de deploy a Vercel, no acá.

import { expect, test } from "@playwright/test";

test.describe("Sprint S5 — adaptación V0 (sin auth)", () => {
  test("/login carga y muestra el form de NextAuth", async ({ page }) => {
    await page.goto("/login");
    // El form de NextAuth v5 siempre tiene un input email + password + submit.
    await expect(page.getByLabel(/email|correo|usuario/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/password|contraseña/i).first()).toBeVisible();
  });

  test("redirige a /login cuando no hay sesion (proxy.ts)", async ({ page }) => {
    const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
    // 200 después del redirect (proxy.ts hace la redirect, /login responde 200)
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/login/);
  });
});
