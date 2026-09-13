/**
 * instrumentation.ts — hook de arranque del server (Next.js).
 *
 * Auditoría 2026-09-10 (#43): valida las variables de entorno al arrancar
 * y reporta faltantes críticas/recomendadas en los logs. NO tumba el
 * server (los errores críticos de auth/deploy los maneja cada módulo);
 * el objetivo es visibilidad temprana.
 *
 * Solo corre en runtime Node (`NEXT_RUNTIME === "nodejs"`): el import de
 * `lib/env` y el acceso a `process.env` completo no aplican en Edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportEnv } = await import("./lib/env");
    reportEnv();
  }
}
