// TypeScript declarations for lib/djiag-backoff.js
//
// XS3 (audit 2026-07-22, docs/DJIAG_AUDIT.md H6).
// Companion type shim para el helper de backoff puro CJS.

export interface BackoffOptions {
  /** Total de intentos (incluye el inicial). Default 3. */
  maxAttempts?: number;
  /** Delay base en ms antes del primer retry. Default 1500. */
  baseDelayMs?: number;
  /** Cap del delay en ms (limite superior despues de jitter). Default 30000. */
  maxDelayMs?: number;
  /** Fraccion de jitter aplicado al delay. 0.25 = +-25%. Default 0.25. */
  jitter?: number;
  /** Determina si un error es recuperable. Si devuelve false, throw inmediato. */
  shouldRetry?: (err: unknown) => boolean;
  /** Sleep inyectable (para tests con fake timers). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Callback invocado antes de cada retry. */
  onRetry?: (info: { attempt: number; delayMs: number; err: unknown }) => void;
}

export function withBackoff<T>(
  fn: () => Promise<T>,
  opts?: BackoffOptions
): Promise<T>;

export function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter?: number
): number;

export function defaultShouldRetry(err: unknown): boolean;

export const DEFAULT_MAX_ATTEMPTS: number;
export const DEFAULT_BASE_DELAY_MS: number;
export const DEFAULT_MAX_DELAY_MS: number;
export const DEFAULT_JITTER: number;
