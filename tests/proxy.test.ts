/**
 * tests/proxy.test.ts
 *
 * Bug 2 (2026-09-08) — anti-regression: el default export de `proxy.ts`
 * debe ser la función `auth` cruda de NextAuth. Si alguien la wrappea con
 * un handler (e.g. `auth((req) => NextResponse.next())`), el callback
 * `authorized` se bypasea y la auth gate deja de funcionar — caso real:
 * `/geovisor` accesible sin login.
 *
 * Ver `docs/BUG-2-AUTH-DIAGNOSTIC.md` para el contexto completo.
 *
 * Estrategia: mockear `next-auth` y `@/lib/auth.config`, importar
 * `proxy.ts` dinámicamente, y verificar que la referencia del default
 * export sea EXACTAMENTE la misma que la función `auth` que devolvió
 * el mock. Si alguien wrappea `auth(handler)`, el default export es
 * un wrapper (referencia distinta) y este test falla.
 *
 * Tambien incluimos un test source-level como red de seguridad: aunque
 * el import dinámico se rompa por otra razón, el source-level detecta
 * el patrón "auth((_request) =>" que reintrodujo el bug originalmente.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const authFn = vi.fn();
const nextAuthFactory = vi.fn(() => ({ auth: authFn }));

vi.mock("next-auth", () => ({
  default: nextAuthFactory
}));

vi.mock("@/lib/auth.config", () => ({
  authConfig: {
    callbacks: {}
  }
}));

const projectRoot = join(__dirname, "..");

describe("proxy.ts — anti-Bug-2 regression", () => {
  it("default export is the raw `auth` function (no handler wrapper)", async () => {
    // Import dinámico para que el mock de next-auth esté registrado antes
    // de que proxy.ts ejecute `NextAuth(authConfig)`.
    const proxy = await import("@/proxy");
    const defaultExport = (proxy as { default?: unknown }).default;

    // El bug era: `export default auth((_request) => NextResponse.next())`
    // que crea un wrapper alrededor de `auth`. Ese wrapper se invoca
    // como middleware, pero como la implementación del wrapper
    // hardcoded siempre retorna NextResponse.next(), el callback
    // `authorized` nunca tiene efecto.
    //
    // El fix es `export default auth` — la función cruda. Cuando
    // Next.js 16 invoca la función como middleware, NextAuth v5
    // automáticamente llama al callback `authorized` y redirige a
    // /login si devuelve `false`.
    expect(
      defaultExport,
      "proxy.ts default export debería ser la función `auth` de NextAuth"
    ).toBeDefined();
    expect(
      defaultExport,
      "proxy.ts default export NO debe ser un wrapper alrededor de `auth`. " +
        "Si wrappeas `auth(handler)`, el callback `authorized` se bypasea " +
        "y la auth gate deja de funcionar. Use `export default auth` (raw)."
    ).toBe(authFn);
  });

  it("imports NextAuth factory with the edge-safe authConfig", () => {
    // Verifica que proxy.ts usa `authConfig` (edge-safe, sin providers
    // bcrypt) y NO `auth` (que sí tiene providers Node-only). El
    // bundle del proxy rompería si importara `auth` directamente.
    const src = readFileSync(join(projectRoot, "proxy.ts"), "utf-8");
    // Strip comments
    const noComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(
      noComments.includes('from "@/lib/auth.config"'),
      "proxy.ts debe importar authConfig de @/lib/auth.config (edge-safe)"
    ).toBe(true);
    expect(
      noComments.includes('from "@/lib/auth"'),
      "proxy.ts NO debe importar de @/lib/auth (Node-only, rompería el bundle Edge)"
    ).toBe(false);
  });

  it("source-level guard: no envuelve `auth` con un handler", () => {
    // Red de seguridad: aunque el test de import dinámico se rompa por
    // alguna razón, este test detecta el patrón textual del bug.
    const proxyPath = join(projectRoot, "proxy.ts");
    if (!existsSync(proxyPath)) return;
    const src = readFileSync(proxyPath, "utf-8");
    const noComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // El patrón bugueado era: `auth((_request) => ...` o `auth((req) => ...`
    expect(
      /auth\(\(\s*_?\s*request\s*\)/.test(noComments) ||
        /auth\(\(\s*_?\s*req\s*\)/.test(noComments),
      "proxy.ts wrappea `auth` con un handler. Esto bypasea el callback " +
        "`authorized` y la auth gate deja de funcionar. Use `export default auth` " +
        "(raw) en su lugar. Ver docs/BUG-2-AUTH-DIAGNOSTIC.md."
    ).toBe(false);

    // Verificamos que el export sea de la forma raw: `export default auth`
    expect(
      /export\s+default\s+auth\b/.test(noComments),
      "proxy.ts debe exportar `auth` directamente: `export default auth`"
    ).toBe(true);
  });

  it("source-level guard: el matcher excluye paths publicos correctamente", () => {
    // Sanity check: el matcher sigue cubriendo /geovisor y excluyendo
    // los paths que NO deben pasar por auth (assets, /api/auth, /login).
    const proxyPath = join(projectRoot, "proxy.ts");
    if (!existsSync(proxyPath)) return;
    const src = readFileSync(proxyPath, "utf-8");
    // El matcher debe excluir al menos _next/static, _next/image, favicon,
    // public, y api/auth para que el callback `authorized` no procese
    // requests que no lo necesitan.
    expect(src).toMatch(/_next\/static/);
    expect(src).toMatch(/_next\/image/);
    expect(src).toMatch(/api\/auth/);
  });
});
