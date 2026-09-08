/**
 * tests/app-shell-logo-unoptimized.test.ts
 *
 * Anti-regression para el SVG 400 en `/_next/image?url=%2Fafm-logo.svg`.
 *
 * Contexto historico:
 *   - S10.5 (PR #37) — el mark chico (`/afm-logo-mark.svg`, 120x40) tiraba
 *     400 desde el Image optimizer porque `w=120` no estaba en el
 *     allow-list default de `images.imageSizes`. Fix: agregar `unoptimized`
 *     al <Image> en app-shell.
 *   - QA-01 (PR #60) — el sidebar cambio al logo grande
 *     (`/afm-logo.svg`, 57KB, 485x695) con `width={64} height={92}`.
 *     El logo grande tiene paths SVG complejos y aspect ratio
 *     no-standard para el optimizer. Mismo bug latente.
 *   - Fix 2026-09-08 — agregar `unoptimized` al nuevo <Image>. Patron
 *     identico al de S10.5.
 *
 * Este test es source-level porque renderizar el AppShell requiere
 * mockear Next/Image, NextAuth, NavLinks, etc — y lo unico que nos
 * importa es que el prop `unoptimized` este presente.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = join(__dirname, "..");

describe("app-shell.tsx — sidebar logo SVG unoptimized (anti-400)", () => {
  it("<Image src='/afm-logo.svg'> tiene prop `unoptimized`", () => {
    const appShellPath = join(projectRoot, "components", "app-shell.tsx");
    if (!existsSync(appShellPath)) {
      throw new Error(`No se encontro ${appShellPath}`);
    }
    const src = readFileSync(appShellPath, "utf-8");

    // Strip comments para evitar matches falsos en bloques de comentario.
    const noComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // 1. La sidebar DEBE seguir usando /afm-logo.svg (QA-01). Si alguien
    //    vuelve al mark chico sin agregar el width correcto, este test
    //    falla con un mensaje claro.
    expect(
      noComments.includes('src="/afm-logo.svg"'),
      "app-shell.tsx deberia usar `/afm-logo.svg` (logo grande, QA-01)"
    ).toBe(true);

    // 2. El prop `unoptimized` DEBE estar presente en el <Image> del
    //    logo. Sin el, el optimizer devuelve 400 para SVGs con paths
    //    complejos o aspect ratio no-standard. Ver docs/S10-5-FINALIZACION.md
    //    para el root cause original (w=120 fuera del allow-list).
    expect(
      /\bunoptimized\b/.test(noComments),
      "app-shell.tsx deberia tener prop `unoptimized` en el <Image> del logo. " +
        "Sin esto, el Image optimizer devuelve 400 para SVGs con paths " +
        "complejos o aspect ratio no-standard. Ver docs/S10-5-FINALIZACION.md " +
        "(PR #37) para el root cause original del SVG 400."
    ).toBe(true);

    // 3. El <Image> del logo y el `unoptimized` deben estar en la misma
    //    region del archivo (mismo JSX block). Buscamos un patron
    //    `<Image ... unoptimized ... />` o `<Image ... unoptimized>`.
    const imageUnoptimizedPattern =
      /<Image[\s\S]{0,500}?unoptimized[\s\S]{0,500}?>/;
    expect(
      imageUnoptimizedPattern.test(noComments),
      "El prop `unoptimized` debe estar en un <Image>. Si esta en otro " +
        "componente, este test no detecta la regresion. Revisar que el " +
        "<Image src='/afm-logo.svg'> en app-shell.tsx tenga el prop."
    ).toBe(true);
  });
});
