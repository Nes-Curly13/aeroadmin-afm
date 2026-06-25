import { Pool, types } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __afmPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __afmPgTypesPatched: boolean | undefined;
}

/**
 * `pg` por defecto devuelve columnas `NUMERIC` y `INT8 (bigint)` como STRINGS,
 * aunque los tipos TypeScript digan `number`. Esto rompe cualquier `.toFixed()`,
 * `.toLocaleString()` o suma con `+`. Lo parcheamos una vez al cargar el módulo.
 *
 * Por qué aquí y no en cada query: registrar el type parser es idempotente y
 * aplica a TODAS las queries que pasan por este pool — un solo cambio, sin
 * riesgo de olvidar un call site.
 *
 * Si rompés esto, el dashboard, history y parcel detail empiezan a tirar
 * "v.toFixed is not a function" / "[object Date]" en producción.
 *
 * Referencia: https://node-postgres.com/features/types#built-in-support
 */
function patchPgTypes() {
  if (global.__afmPgTypesPatched) return;
  // NUMERIC (oid 1700) → number (parseFloat preserva decimales; pierde precisión >2^53 pero ok para ha/L/m²)
  types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));
  // INT8 / BIGINT (oid 20) → number (parseInt porque no usamos >2^31 en este dominio)
  types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));
  global.__afmPgTypesPatched = true;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT;
  const useSsl = process.env.DATABASE_SSL === "true";

  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });
}

export function getDb() {
  if (!global.__afmPgTypesPatched) {
    patchPgTypes();
  }
  if (!global.__afmPool) {
    global.__afmPool = createPool();
  }

  return global.__afmPool;
}
