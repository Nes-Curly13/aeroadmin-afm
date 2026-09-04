/**
 * middleware.ts (shim de compatibilidad).
 *
 * S10.5.2 (2026-09-04) — Bug 2: Vercel no detecta `proxy.ts` (Next.js 16
 * renombró `middleware.ts` → `proxy.ts`, pero Vercel puede no reconocer
 * el nombre nuevo todavía). Resultado: el middleware NO se invoca en el
 * deploy, y rutas autenticadas como /geovisor quedan accesibles sin
 * sesión. Esto es un agujero de seguridad crítico.
 *
 * Workaround: este archivo re-exporta `default` y `config` desde
 * `./proxy`. Cubre AMBAS convenciones:
 *   - Vercel ve `middleware.ts` → invoca el middleware.
 *   - Next.js 16 CLI ve `proxy.ts` → también lo invoca.
 * El código vive en `proxy.ts` (single source of truth).
 *
 * Si en el futuro Vercel soporta oficialmente `proxy.ts`, este shim se
 * puede borrar (los tests estructurales en tests/middleware-compat.test.ts
 * van a fallar para forzar la decisión).
 *
 * Ver tests/middleware-compat.test.ts para la regression test.
 */
export { default, config } from "./proxy";
