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
 *   - Refactor 2026-09-10 — el logo de marca se movio a
 *     <components/brand/afm-mark.tsx>. La logica de `unoptimized` vive
 *     ahi (NEEDS_UNOPTIMIZED: mark=false, full=true). El sidebar ahora
 *     usa `<AfmMark variant="mark" />` (sin riesgo 400) y el login
 *     usa `<AfmMark variant="full" />` (riesgo 400 → unoptimized ON).
 *
 *   El anti-regression ahora se chequea en 2 lugares:
 *     A) El sidebar NO usa el logo grande directamente (uso via AfmMark).
 *     B) El login SI usa el logo grande (necesita unoptimized via AfmMark).
 *     C) El componente AfmMark tiene un test dedicado (test #4 de
 *        afm-mark.test.tsx) que valida `unoptimized` por variant.
 *        Eso es el verdadero lock — si alguien lo rompe, ese test falla.
 *
 *   Este test source-level queda como segunda linea de defensa:
 *     si alguien pone `<Image src="/afm-logo.svg" />` directo en algun
 *     componente sin pasar por AfmMark, este test lo cacha.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = join(__dirname, "..");

function readNoComments(relPath: string): string {
  const fullPath = join(projectRoot, relPath);
  if (!existsSync(fullPath)) {
    throw new Error(`No se encontro ${fullPath}`);
  }
  return readFileSync(fullPath, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("brand integration — anti-SVG-400", () => {
  it("sidebar usa <AfmMark /> (no <Image src='/afm-logo.svg' /> directo)", () => {
    // PR-2 (auditoría UI, 2026-09-20): el markup del sidebar se movió de
    // app-shell.tsx a components/shell-layout.tsx. El contrato anti-SVG-400
    // es el mismo: la marca va por el wrapper <AfmMark />, nunca el svg
    // directo. app-shell.tsx queda como wrapper server que delega.
    const appShell = readNoComments("components/app-shell.tsx");
    const sidebar = readNoComments("components/shell-layout.tsx");
    expect(
      appShell.includes("ShellLayout"),
      "app-shell.tsx debe delegar en <ShellLayout /> (única arquitectura de sidebar)."
    ).toBe(true);
    expect(
      sidebar.includes('src="/afm-logo.svg"'),
      "shell-layout.tsx no debe usar /afm-logo.svg directo. Usar <AfmMark />."
    ).toBe(false);
    expect(
      sidebar.includes("AfmMark"),
      "shell-layout.tsx debe usar el componente <AfmMark />."
    ).toBe(true);
  });

  it("login page usa <AfmMark variant='full' /> (logo grande, requiere unoptimized)", () => {
    const login = readNoComments("app/(public)/login/page.tsx");
    // El full logo solo se renderiza seguro si pasa por <AfmMark />,
    // que internamente setea `unoptimized: true` (ver NEEDS_UNOPTIMIZED
    // en components/brand/afm-mark.tsx + test #4 de afm-mark.test.tsx).
    expect(
      login.includes("AfmMark"),
      "login/page.tsx debe usar el componente <AfmMark />."
    ).toBe(true);
    expect(
      /variant=["']full["']/.test(login),
      "login/page.tsx debe usar <AfmMark variant='full' /> para el " +
        "monograma completo (57KB, requiere unoptimized=true)."
    ).toBe(true);
    // Anti-regression directa: nadie debe saltarse el wrapper y poner
    // un <Image> con el logo grande directo sin unoptimized.
    expect(
      login.includes('src="/afm-logo.svg"'),
      "login/page.tsx no debe usar /afm-logo.svg directo. Usar <AfmMark variant='full' />."
    ).toBe(false);
  });

  it("AfmMark tiene la logica unoptimized para variant='full'", () => {
    const brand = readNoComments("components/brand/afm-mark.tsx");
    // El test verdadero del comportamiento esta en afm-mark.test.tsx
    // (test #4: variant='full' propaga unoptimized=true). Aca solo
    // aseguramos que la declaracion NEEDS_UNOPTIMIZED siga presente,
    // como segunda linea de defensa.
    expect(
      brand.includes("NEEDS_UNOPTIMIZED") || brand.includes("unoptimized={"),
      "components/brand/afm-mark.tsx debe declarar/loggear unoptimized por variant."
    ).toBe(true);
  });
});
