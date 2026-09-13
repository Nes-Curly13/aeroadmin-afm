/**
 * lib/timing-safe.ts — comparación de strings en tiempo constante.
 *
 * Evita el timing attack clásico donde un atacante mide el tiempo de
 * respuesta para adivinar un token byte a byte. Se usa para validar
 * tokens internos (`HEALTH_TOKEN`, `INTERNAL_MAP_TOKEN`).
 *
 * Extraído a `lib/` para no duplicar la implementación entre
 * `app/api/admin/djiag-health` y `app/api/internal/print-map`.
 */

/** Compara `a` y `b` en tiempo constante. Longitudes distintas → false. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
