// TypeScript declarations for lib/djiag-circuit-breaker.js
//
// S1 (audit 2026-07-22, docs/DJIAG_AUDIT.md H2).
// Companion type shim para el circuit breaker del cliente DJI.

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Failures consecutivos para abrir. Default 3. */
  failureThreshold?: number;
  /** Ms antes de half-open. Default 300000 (5 min). */
  resetTimeoutMs?: number;
  /** Path a _health.json para persistir. Opcional. */
  healthFilePath?: string;
  /** Clock inyectable para tests. */
  now?: () => Date;
}

export interface CircuitSnapshot {
  state: CircuitState;
  failureCount: number;
  openedAt: string | null;
  lastFailureAt: string | null;
  failureThreshold: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  constructor(options?: CircuitBreakerOptions);
  state: CircuitState;
  failureCount: number;
  openedAt: string | null;
  lastFailureAt: string | null;
  failureThreshold: number;
  resetTimeoutMs: number;
  healthFilePath: string | null;

  /** Devuelve el state, aplicando transicion open->half-open si corresponde. */
  getState(): CircuitState;
  /** Throws con mensaje "Circuit open, retry in XmYYs" si esta open. */
  guard(): void;
  /** Registra exito; transiciona a closed. */
  recordSuccess(): void;
  /** Registra failure; abre si llega al threshold. */
  recordFailure(): void;
  /** Ms restantes antes de half-open. 0 si no esta open o ya expiro. */
  msUntilHalfOpen(): number;
  /** Snapshot del state actual. */
  snapshot(): CircuitSnapshot;
  /** Reset completo. */
  reset(): void;
}

export function formatRemaining(ms: number): string;

export const DEFAULT_FAILURE_THRESHOLD: number;
export const DEFAULT_RESET_TIMEOUT_MS: number;
