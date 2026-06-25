// Tipos para el módulo JS de cadencias.
// El módulo real es CommonJS en lib/fumigation-cadence-config.js —
// este .d.ts existe para que el código TypeScript (tests, importers
// de TS en el futuro) pueda importarlo con tipos.

export interface CadenceConfig {
  /**
   * Defaults por field_type. `Farmland` y `Orchards` pueden o no estar
   * en el JSON — `resolveCadence` hace fallback al builtin si faltan.
   * Cualquier key extra es válida (forward-compat para nuevos field_types).
   */
  defaults: { Farmland?: number; Orchards?: number; [fieldType: string]: number | undefined };
  by_crop: Record<string, number>;
  by_drone: Record<string, number>;
  by_parcel: Record<string, number>;
  _source: string;
}

export interface ResolveCadenceArgs {
  externalId: string | null | undefined;
  droneModelCode: number | string | null | undefined;
  fieldType: string | null | undefined;
  currentCropType: string | null | undefined;
}

export interface ResolvedCadence {
  cadence_days: number;
  crop_type: string;
  reason: string;
}

export declare const BUILTIN_DEFAULTS: {
  readonly cadence: {
    readonly Farmland: 14;
    readonly Orchards: 10;
  };
  readonly crop_type: {
    readonly Farmland: "Caña de azúcar";
    readonly Orchards: "Frutales";
  };
};

export declare function normalizeCropKey(s: string | null | undefined): string;
export declare function defaultCropTypeFor(fieldType: string | null | undefined): string;
export declare function loadCadenceConfig(configPath: string | null | undefined): CadenceConfig;
export declare function resolveCadence(
  args: ResolveCadenceArgs,
  config: CadenceConfig
): ResolvedCadence;
