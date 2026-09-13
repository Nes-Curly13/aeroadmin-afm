// lib/api-error.ts
//
// Helpers para respuesta de errores en route handlers. Separa 2 cosas:
//   1) El MENSAJE que se envia al cliente (puede filtrar detalles de BD).
//   2) El LOG server-side (full error, para debugging).
//
// Por que existe:
//   Antes (issue #28): ~15 route handlers hacian
//     return NextResponse.json({ error: "error interno", detail: message }, ...)
//   donde `message = err.message` podia ser:
//     - "duplicate key value violates unique constraint \"uq_xxx\"" →
//       leak de nombres de constraints
//     - "insert or update on table \"dji_fumigations\" violates foreign key
//       constraint \"dji_fumigations_parcel_id_fkey\"" → leak de schema
//     - "connection terminated unexpectedly" → confunde al usuario
//
//   Ahora: el helper detecta si el error viene de `pg` y lo reemplaza
//   por un mensaje generico. El full error se loguea server-side para
//   que el dev pueda verlo en los logs de Vercel / del server.

/** Subset de `pg` error fields que usamos para detectar errores de BD. */
interface PgErrorLike {
  code?: string;
  detail?: string;
  table?: string;
  constraint?: string;
  /** pg errors son instancias de Error; usamos este duck typing. */
  message?: string;
}

/** Mensajes genericos por codigo de error pg comun.
 *  Mapeamos a algo que el usuario final pueda entender sin filtrar
 *  metadata del schema. */
const PG_ERROR_MESSAGES: Record<string, string> = {
  // Unique constraint / duplicate
  "23505": "Ya existe un registro con esos datos unicos",
  // Foreign key violation
  "23503": "La operacion referencia un registro que no existe o fue borrado",
  // Check constraint
  "23514": "Los datos no cumplen las validaciones de la tabla",
  // Not null violation
  "23502": "Falta un campo obligatorio",
  // Invalid text representation (bad UUID, bad date, etc.)
  "22P02": "Formato de dato invalido",
  // Insufficient privilege
  "42501": "Sin permisos para realizar esta operacion",
  // Undefined column
  "42703": "Error interno del servidor",
  // Undefined table
  "42P01": "Error interno del servidor",
  // Connection failure
  "08006": "No se pudo conectar a la base de datos. Reintentando...",
  "08001": "No se pudo conectar a la base de datos. Reintentando...",
  // Serialization failure (retry)
  "40001": "Conflicto de concurrencia. Reintentando..."
};

/** Determina si un error viene de `pg` (tiene campos tipicos de pg). */
export function isPgError(err: unknown): err is Error & PgErrorLike {
  if (!(err instanceof Error)) return false;
  // pg errors tienen `code` (string SQLSTATE) y tipicamente `detail` o
  // `table`/`constraint`. Tambien el constructor se llama `DatabaseError`
  // pero ese nombre NO es estable; usamos duck typing.
  const e = err as PgErrorLike;
  return typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code);
}

/** Helper principal: devuelve el mensaje seguro para enviar al cliente.
 *
 * @param err            - el error capturado
 * @param fallback       - mensaje generico si no podemos identificar el error
 * @param requestContext - contexto (ej. "POST /api/admin/farms") para el log
 */
export function clientSafeErrorMessage(
  err: unknown,
  fallback: string,
  requestContext?: string
): string {
  // Log full error server-side. NO usar `console.error` con datos
  // sensibles del usuario (PII). El handler que llame a este helper
  // debe sanitizar su log si es necesario.
  if (requestContext) {
    // eslint-disable-next-line no-console
    console.error(`[${requestContext}] error:`, err);
  } else {
    // eslint-disable-next-line no-console
    console.error("API error:", err);
  }

  if (isPgError(err)) {
    const code = (err as PgErrorLike).code as string;
    if (PG_ERROR_MESSAGES[code]) {
      return PG_ERROR_MESSAGES[code];
    }
    // Si tenemos code pero no esta en el mapa, devolvemos el fallback
    // (NO el mensaje crudo). El dev lo ve en el log.
    return fallback;
  }

  // Si NO es un pg error, podemos ser mas especificos.
  // Si es un Error generico con un mensaje "humano" (ej. "no autenticado"),
  // lo dejamos pasar. Pero evitamos mensajes que parezcan de pg.
  if (err instanceof Error) {
    const msg = err.message;
    // Mensajes que parecen de pg (constraint/relation names) → fallback.
    if (
      /constraint\s+"?\w+/i.test(msg) ||
      /relation\s+"?\w+"?\s+does not exist/i.test(msg) ||
      /column\s+"?\w+"?\s+does not exist/i.test(msg)
    ) {
      return fallback;
    }
    return msg;
  }
  return fallback;
}
