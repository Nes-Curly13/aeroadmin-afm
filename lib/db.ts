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

  // 2026-09-13 (regresión #26 revertida): el default `rejectUnauthorized:
  // true` rompía la conexión a Supabase con "self-signed certificate in
  // certificate chain" → el login quedaba caído. El pooler de Supabase
  // presenta una cadena de certificados que Node no confía por default.
  // El default vuelve a ser `rejectUnauthorized: false` (comportamiento
  // pre-#26, compatible con Supabase).
  //
  // Para EXIGIR verificación de certificado (self-host con la CA en el
  // trust store, o Supabase con la CA configurada), setear
  // `DATABASE_SSL_STRICT=true`.
  const sslStrict = process.env.DATABASE_SSL_STRICT === "true";
  const sslConfig: { rejectUnauthorized: boolean } | undefined = useSsl
    ? { rejectUnauthorized: sslStrict }
    : undefined;

  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    // Auditoría 2026-09-10 (#44): sin timeouts, una query colgada bloquea
    // un slot del pool (max 5) y, en Vercel, la función corre hasta el
    // límite de la plataforma. `connectionTimeoutMillis` evita esperar
    // una conexión indefinidamente; `statement_timeout` corta queries
    // lentas en el server; `query_timeout` corta en el cliente.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    ssl: sslConfig,
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
