/**
 * Tests para el workaround de compatibilidad middleware.ts vs proxy.ts
 * (S10.5.2 / 2026-09-04).
 *
 * Contexto: Next.js 16 renombró `middleware.ts` a `proxy.ts`. Vercel puede
 * no reconocer `proxy.ts` todavía y por lo tanto NO invoca el middleware,
 * dejando todas las rutas autenticadas accesibles sin sesión. Esto es un
 * agujero de seguridad crítico (cualquiera con el URL ve data del operador).
 *
 * Hipótesis (a verificar): el deploy de Vercel no está ejecutando el
 * `proxy.ts` (probado en práctica: /geovisor responde 200 OK sin sesión).
 * El código del middleware ESTÁ BIEN (los tests del `authorized` callback
 * pasan — tests/auth.test.ts:258-296).
 *
 * Workaround defensivo: crear `middleware.ts` que re-exporta `proxy.ts`.
 * Cubre AMBAS convenciones (Vercel usa `middleware.ts`, Next.js 16 CLI
 * usa `proxy.ts`). Costo: 1 archivo de 2 líneas.
 *
 * Estos tests son estructurales (igual que tests/app-layout-login-routing.test.ts):
 * leen el filesystem y verifican que `middleware.ts` existe y que
 * re-exporta correctamente. Si alguien borra el `middleware.ts` o cambia
 * el re-export, este test falla.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(__dirname, "..");

describe("Middleware compatibility — Vercel puede no detectar proxy.ts", () => {
  it("1. middleware.ts existe en la raiz del proyecto", () => {
    const middlewarePath = join(projectRoot, "middleware.ts");
    expect(
      existsSync(middlewarePath),
      `Expected ${middlewarePath} to exist. Sin este archivo, Vercel puede no estar invocando el proxy (Next.js 16 lo renombró a proxy.ts pero Vercel aún espera middleware.ts).`
    ).toBe(true);
  });

  it("2. middleware.ts re-exporta default y config desde proxy.ts", () => {
    const middlewarePath = join(projectRoot, "middleware.ts");
    if (!existsSync(middlewarePath)) {
      // El test #1 ya cubre este caso; skip silencioso.
      return;
    }
    const raw = readFileSync(middlewarePath, "utf-8");
    // Strip comments antes de buscar (los comentarios no cuentan como uso).
    const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const noLineComments = noBlockComments.replace(/^\s*\/\/.*$/gm, "");
    // Verifica que el archivo hace el re-export esperado.
    expect(
      noLineComments.includes("export { default, config } from \"./proxy\""),
      `${middlewarePath} debería re-exportar default y config desde ./proxy. Encontrado:\n${noLineComments}`
    ).toBe(true);
  });

  it("3. proxy.ts sigue existiendo (es el source of truth)", () => {
    // El middleware.ts es solo un shim. La lógica vive en proxy.ts.
    // Si alguien borra proxy.ts pensando que middleware.ts lo reemplaza,
    // rompe la convención de Next.js 16.
    const proxyPath = join(projectRoot, "proxy.ts");
    expect(
      existsSync(proxyPath),
      `${proxyPath} debería existir — es el source of truth de la lógica del middleware. middleware.ts es solo un shim para compatibilidad con Vercel.`
    ).toBe(true);
  });
});
