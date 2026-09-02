/**
 * tests/app-layout-login-routing.test.ts
 *
 * S10.4 (2026-09-01) — fixture de regresión para el bug
 * "AppShell se muestra en /login".
 *
 * ANTES: `app/layout.tsx` envolvía TODO con `<AppShell>{children}</AppShell>`.
 * El login page esperaba estar limpio (sin sidebar) — la app mostraba
 * el sidebar con "AFM Geovisor", nav links, "Cerrar sesión" y el logo
 * AFM al lado del form. UX roto: el operador veía su propio panel
 * mientras intentaba loguearse.
 *
 * FIX: route groups de Next.js 16. `app/(public)/login/page.tsx` queda
 * fuera del shell — `app/(public)/layout.tsx` retorna solo `{children}`.
 *
 * Este test verifica que la estructura del layout de /login NO incluye
 * el AppShell. Es un test estático (lee el filesystem) porque renderizar
 * el root layout en jsdom es complejo y el contrato es estructural.
 *
 * Si en el futuro alguien mueve login/ fuera de (public)/, este test
 * falla con un mensaje claro.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(__dirname, "..");

describe("Root layout routing — /login no debe estar dentro de AppShell", () => {
  it("1. app/(public)/layout.tsx existe (route group para páginas públicas)", () => {
    const publicLayout = join(projectRoot, "app", "(public)", "layout.tsx");
    expect(
      existsSync(publicLayout),
      `Expected ${publicLayout} to exist. Sin este archivo, el root layout envuelve /login con AppShell.`
    ).toBe(true);
  });

  it("2. app/(public)/layout.tsx NO importa AppShell (es layout mínimo)", () => {
    const publicLayoutPath = join(
      projectRoot,
      "app",
      "(public)",
      "layout.tsx"
    );
    if (!existsSync(publicLayoutPath)) {
      // El test #1 ya cubre este caso; skip silencioso.
      return;
    }
    const raw = readFileSync(publicLayoutPath, "utf-8");
    // Strip /* ... */ y // ... comments antes de buscar imports/JSX.
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    const importsAppShell = /import\s+[^;]*AppShell/.test(noLineComments);
    const rendersAppShell = /<AppShell\b/.test(noLineComments);
    expect(
      importsAppShell || rendersAppShell,
      `${publicLayoutPath} importa o renderiza AppShell. Debería ser un layout mínimo (solo {children}) para que /login no muestre el sidebar.`
    ).toBe(false);
  });

  it("3. app/(public)/login/page.tsx existe (login vive dentro del route group público)", () => {
    const loginInPublic = join(
      projectRoot,
      "app",
      "(public)",
      "login",
      "page.tsx"
    );
    expect(
      existsSync(loginInPublic),
      `Expected ${loginInPublic} to exist. La página /login debe estar en (public)/ para quedar fuera del AppShell.`
    ).toBe(true);
  });

  it("4. NO existe app/login/page.tsx suelto (sería ignorado por Next.js si también está en (public)/)", () => {
    const loginLone = join(projectRoot, "app", "login", "page.tsx");
    if (existsSync(loginLone)) {
      // Si existe, podría ser un archivo viejo o un symlink. En cualquier
      // caso, es confuso. Marcamos como falla suave.
      throw new Error(
        `app/login/page.tsx existe fuera de (public)/. Esto puede causar que Next.js sirva el login con el AppShell. Borrar o mover.`
      );
    }
  });
});

describe("AppShell — sigue intacto en páginas autenticadas", () => {
  it("5. app/layout.tsx sigue wrappeando con AppShell (no se rompe el resto)", () => {
    const rootLayout = join(projectRoot, "app", "layout.tsx");
    const source = readFileSync(rootLayout, "utf-8");
    expect(
      source.includes("AppShell"),
      "app/layout.tsx debe seguir wrappeando con AppShell para las páginas autenticadas."
    ).toBe(true);
  });
});
