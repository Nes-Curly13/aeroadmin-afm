// lib/season.ts
//
// Lógica pura de estación climática y cadencia efectiva por estación.
//
// Por qué existe:
//   docs/FUMIGATION_CADENCE.md §"Lo que NO sabemos" gap #2 (estación)
//   está cerrado por este módulo + la integración en
//   `lib/fumigation-cadence.ts#effectiveCadence`.
//
// Decisiones de diseño:
//   - Valle del Cauca tiene 2 estaciones marcadas (IDEAM):
//       secas   (jun-sep)
//       lluvias (oct-may)
//     Regla hardcodeada por ahora. La firma toma `latitude, longitude`
//     para que un sprint futuro pueda extender a otras regiones usando
//     coordenadas (microclimas, valle vs ladera, etc.).
//   - Multiplicadores:
//       secas   × 1.5 (menos presión fúngica → se puede espaciar más)
//       lluvias × 1.0 (default operativo, más presión)
//     Para orchards en lluvias, la presión fúngica es mayor y se debe
//     ACERCAR la cadencia (fumigar más seguido). El ajuste 0.7 vive en
//     `lib/fumigation-cadence.ts#effectiveCadence` (ahí conocemos el
//     cropType), no acá. Este módulo se mantiene dumb sobre cropType
//     para que la función sea simple y reusable.
//   - Meses 1-indexados (enero=1, diciembre=12) para que el caller pueda
//     pasar `date.getMonth() + 1` sin off-by-one.
//   - `cadenceMultiplierForSeason(base, season)` devuelve el resultado
//     FINAL (base × multiplier), no el multiplier solo. La firma dice
//     "Multiplier" pero el contrato es producto — está documentado
//     arriba. Si en el futuro se quiere el multiplier solo, agregar
//     una segunda función `getSeasonMultiplier(season)`.

/** Estaciones del Valle del Cauca. */
export type Season = "secas" | "lluvias";

/** Meses (1-indexados) de la temporada seca en Valle del Cauca. */
const SECAS_MONTHS: ReadonlySet<number> = new Set([6, 7, 8, 9]);

/**
 * Devuelve la estación climática para una fecha y coordenadas dadas.
 *
 * @param date  Fecha a evaluar. Leemos el mes en UTC para que la
 *              función sea determinística independiente del timezone
 *              del host. Si el caller quiere leer en hora local
 *              colombiana, debe construir un `Date` que represente
 *              la medianoche UTC del día que le interesa (típicamente
 *              lo que devuelve `getBogotaDateString()`).
 * @param latitude  Latitud (reservado para extensiones futuras, hoy
 *                  no se usa).
 * @param longitude  Longitud (reservado para extensiones futuras, hoy
 *                  no se usa).
 *
 * @example
 *   getSeason(new Date('2026-08-15'), 3.45, -76.5)  // 'secas'
 *   getSeason(new Date('2026-02-15'), 3.45, -76.5)  // 'lluvias'
 *
 * La firma toma lat/lon para que un sprint futuro pueda:
 *   - Agregar reglas por microclima (e.g. ladera occidental del Valle)
 *   - Soportar otras regiones (e.g. Cauca, Risaralda)
 * sin romper callers.
 */
export function getSeason(
  date: Date,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  latitude: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  longitude: number
): Season {
  // Usamos getUTCMonth (no getMonth) para que la función sea TZ-safe.
  // En host con TZ UTC-5 (Bogota), `new Date("2026-10-01")` se parsea
  // como UTC midnight = Sept 30 19:00 local, y getMonth() devolvería 8
  // (Sept) — incorrecto. getUTCMonth() devuelve 9 (Oct) en cualquier TZ.
  const month = date.getUTCMonth() + 1; // 1-indexed
  if (SECAS_MONTHS.has(month)) return "secas";
  return "lluvias";
}

/**
 * Devuelve la cadencia ajustada por estación.
 *
 * Reglas (Valle del Cauca):
 *   - secas:   base × 1.5 (fumigar menos seguido — menos presión fúngica)
 *   - lluvias: base × 1.0 (default operativo)
 *
 * El resultado nunca es menor a 1 día (sanity check contra inputs
 * degenerados).
 *
 * NOTA sobre orchards: la regla "orchards en lluvias → 0.7" (más
 * fumigación) NO se aplica acá porque esta función no conoce el
 * `cropType`. La regla vive en `lib/fumigation-cadence.ts#effectiveCadence`,
 * que sí recibe `cropType` y aplica el 0.7 después de este ajuste.
 */
export function cadenceMultiplierForSeason(
  baseCadence: number,
  season: Season
): number {
  const multiplier = season === "secas" ? 1.5 : 1.0;
  const adjusted = baseCadence * multiplier;
  return Math.max(1, Math.round(adjusted));
}
