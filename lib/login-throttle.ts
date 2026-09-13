/**
 * lib/login-throttle.ts — throttle in-memory de intentos de login.
 *
 * Auditoría 2026-09-10 (#57): no había ninguna defensa contra
 * brute-force en el login (Credentials + bcrypt). Este módulo lleva un
 * contador de fallos por email en memoria del proceso.
 *
 * Limitaciones (documentadas a propósito):
 *   - **Per-instance**: en serverless (Vercel) cada instancia tiene su
 *     propio `Map`. No es un throttle distribuido; es una primera línea
 *     de defensa. Para multi-instancia real, migrar a Upstash/Redis.
 *   - **Single-tenant**: un solo operador, así que el impacto de un
 *     bloqueo legítimo es bajo (se auto-libera a los 15 min).
 *
 * El caller (`authorize()` en `lib/auth.ts`) consulta `isLoginBlocked`
 * antes de pegarle a la BD, registra fallos con `recordLoginFailure` y
 * limpia con `resetLoginAttempts` en un login exitoso.
 */

const WINDOW_MS = 15 * 60 * 1000; // ventana de conteo
const MAX_ATTEMPTS = 8; // fallos dentro de la ventana antes de bloquear
const BLOCK_MS = 15 * 60 * 1000; // duración del bloqueo

interface ThrottleEntry {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number; // 0 = no bloqueado
}

const attempts = new Map<string, ThrottleEntry>();

/**
 * ¿Está bloqueado el intento de login para `key` (email normalizado)?
 * Limpia entradas expiradas de forma perezosa.
 */
export function isLoginBlocked(key: string, now: number = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;

  if (entry.blockedUntil > now) return true;

  // Si la ventana de conteo expiró (y no está bloqueado), reseteamos.
  if (now - entry.firstFailureAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return false;
}

/** Registra un fallo de login. Bloquea al superar `MAX_ATTEMPTS`. */
export function recordLoginFailure(key: string, now: number = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    attempts.set(key, { failures: 1, firstFailureAt: now, blockedUntil: 0 });
    return;
  }
  entry.failures += 1;
  if (entry.failures >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
}

/** Limpia el contador de un email (login exitoso). */
export function resetLoginAttempts(key: string): void {
  attempts.delete(key);
}

/** Solo para tests. */
export function _resetAllLoginThrottle(): void {
  attempts.clear();
}
