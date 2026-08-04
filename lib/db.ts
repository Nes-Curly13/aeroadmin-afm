import dns from "node:dns";
import { Pool, types } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __afmPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __afmPgTypesPatched: boolean | undefined;
}

// (2026-07-27) DNS resolution order. El host directo de Supabase
// (`db.<ref>.supabase.co`) a veces SOLO tiene AAAA (IPv6), no A —
// `ipv4first` rompía el lookup (ENOTFOUND). Con `verbatim` dejamos
// al resolver del sistema elegir, lo que funciona para dual-stack
// (pooler de Supabase) o single-stack IPv6 (direct).
dns.setDefaultResultOrder("verbatim");

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
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    // (2026-08-04) Forzar client_encoding='UTF8' en el handshake inicial.
    // Sin esto, el driver `pg` puede leer strings como Latin-1 / WIN1252
    // y los caracteres con tilde se rompen al volver por JSON:
    //   "Caña de azúcar" → "CaÃ±a de azÃºcar" (mojibake clásico).
    // El server de Postgres anuncia su encoding default en el handshake
    // de conexión; seteando `client_encoding` acá le pedimos a `pg` que
    // negocie UTF-8 con `SET client_encoding TO 'UTF8'` antes de la
    // primera query. El roundtrip queda correcto:
    //   INSERT 'Caña' (UTF-8 bytes 0xC3 0xB1) → SELECT 'Caña'.
    client_encoding: "UTF8"
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
