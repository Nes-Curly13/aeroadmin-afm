// TypeScript declarations para scripts/check-fumigations-coverage.js (CommonJS).
//
// Solo se usan en tests (los scripts CLI se ejecutan con `node`, no con
// vitest). El .d.ts permite que vitest importe el modulo via `require()`
// sin que TS se queje de "no types".

/**
 * Argumentos parseados del CLI.
 */
export type CoverageArgs = {
  /** Ultimos N dias a chequear (default 30). */
  days: number;
  /** Cobertura minima aceptable, 0-1 (default 0.95 = 95%). */
  threshold: number;
};

export declare function parseArgs(argv: string[]): CoverageArgs;
export declare function main(): Promise<void>;
