/**
 * tests/app-layout-login-routing.test.ts
 *
 * S10.4 (2026-09-01) + S10.5 (2026-09-02) — fixture de regresión para
 * el bug "AppShell se muestra en /login".
 *
 * ANTES (S10.4): `app/layout.tsx` envolvía TODO con `<AppShell>{children}</AppShell>`.
 * El login page esperaba estar limpio (sin sidebar) — la app mostraba
 * el sidebar con "AFM Geovisor", nav links, "Cerrar sesión" y el logo
 * AFM al lado del form. UX roto: el operador veía su propio panel
 * mientras intentaba loguearse.
 *
 * FIX S10.4: route groups de Next.js 16. `app/(public)/login/page.tsx` queda
 * fuera del shell — `app/(public)/layout.tsx` retorna solo `{children}`.
 * + workaround: `proxy.ts` setea `x-pathname` + root layout chequea
 * `PUBLIC_PATHS` para skipear AppShell en /login.
 *
 * FIX S10.5 (este test): patrón idiomático. El AppShell vive en
 * `app/(auth)/layout.tsx` (sibling del (public)/ group). El root layout
 * `app/layout.tsx` queda mínimo. `proxy.ts` no necesita inyectar nada.
 *
 * Este test verifica que la ESTRUCTURA del layout NO incluye el AppShell
 * en /login y SÍ lo incluye en las páginas autenticadas. Es un test
 * estático (lee el filesystem) porque renderizar el root layout en jsdom
 * es complejo y el contrato es estructural.
 *
 * Si alguien mueve login/ fuera de (public)/, o mete AppShell de vuelta
 * en el root layout, este test falla con un mensaje claro.
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

describe("Auth pages — AppShell via (auth)/ route group (S10.5)", () => {
  it("5. app/(auth)/layout.tsx existe (route group para páginas autenticadas)", () => {
    const authLayout = join(projectRoot, "app", "(auth)", "layout.tsx");
    expect(
      existsSync(authLayout),
      `Expected ${authLayout} to exist. Sin este archivo, las páginas autenticadas no se envuelven con AppShell. (Reemplaza el workaround de S10.4 con proxy.ts + x-pathname.)`
    ).toBe(true);
  });

  it("6. app/(auth)/layout.tsx IMPORTA y RENDERIZA AppShell", () => {
    const authLayoutPath = join(
      projectRoot,
      "app",
      "(auth)",
      "layout.tsx"
    );
    if (!existsSync(authLayoutPath)) {
      // El test #5 ya cubre este caso; skip silencioso.
      return;
    }
    const raw = readFileSync(authLayoutPath, "utf-8");
    // Strip /* ... */ y // ... comments antes de buscar imports/JSX.
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    const importsAppShell = /import\s+[^;]*AppShell/.test(noLineComments);
    const rendersAppShell = /<AppShell\b/.test(noLineComments);
    expect(
      importsAppShell,
      `${authLayoutPath} no importa AppShell. El route group (auth) DEBE wrappear con AppShell.`
    ).toBe(true);
    expect(
      rendersAppShell,
      `${authLayoutPath} no renderiza <AppShell>. El route group (auth) DEBE wrappear con AppShell.`
    ).toBe(true);
  });

  it("7. app/layout.tsx (root) NO importa AppShell (S10.5 — simplificado)", () => {
    const rootLayout = join(projectRoot, "app", "layout.tsx");
    const raw = readFileSync(rootLayout, "utf-8");
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    const importsAppShell = /import\s+[^;]*AppShell/.test(noLineComments);
    const rendersAppShell = /<AppShell\b/.test(noLineComments);
    expect(
      importsAppShell || rendersAppShell,
      `app/layout.tsx (root) importa o renderiza AppShell. En S10.5 el AppShell vive SOLO en app/(auth)/layout.tsx — el root layout debe ser mínimo (solo <html><body>).`
    ).toBe(false);
  });

  it("8. app/layout.tsx (root) NO usa headers() ni PUBLIC_PATHS (S10.5 — simplificado)", () => {
    // El workaround de S10.4 necesitaba leer el pathname via headers()
    // y compararlo con PUBLIC_PATHS para skipear AppShell en /login.
    // En S10.5 el root layout no necesita nada de eso — /login vive
    // en (public)/, no hereda (auth)/layout.tsx.
    //
    // Strip /* ... */ y // ... comments antes de buscar — los comentarios
    // históricos sobre el workaround no cuentan como uso.
    const rootLayout = join(projectRoot, "app", "layout.tsx");
    const raw = readFileSync(rootLayout, "utf-8");
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    expect(
      noLineComments.includes("headers()") || noLineComments.includes("PUBLIC_PATHS"),
      `app/layout.tsx aún contiene código del workaround de S10.4 (headers() o PUBLIC_PATHS). El root layout debe ser mínimo en S10.5.`
    ).toBe(false);
  });

  it("9. proxy.ts NO inyecta x-pathname (S10.5 — simplificado)", () => {
    const proxyPath = join(projectRoot, "proxy.ts");
    if (!existsSync(proxyPath)) {
      // Si no hay proxy, skip — el test #8 cubre el caso del root layout.
      return;
    }
    // Strip comments antes de buscar — el comentario histórico sobre
    // el workaround removido no cuenta como uso actual.
    const raw = readFileSync(proxyPath, "utf-8");
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    expect(
      noLineComments.includes("x-pathname"),
      `proxy.ts aún inyecta el header x-pathname. Ese workaround se removió en S10.5 — el AppShell ahora vive en (auth)/layout.tsx y no se necesita el header.`
    ).toBe(false);
  });
});
