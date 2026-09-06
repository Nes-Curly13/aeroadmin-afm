/**
 * lib/api-schemas.ts
 *
 * Zod schemas runtime-validating API responses y request bodies.
 *
 * Sprint S11+ — Quality Gauntlet (compuerta 4: zod para testeo de bugs).
 *
 * Por que zod aca:
 * - Caza "API returns 200 with wrong shape" bugs (e.g. el Bug 2 auth bypass
 *   retornaba 200 cuando deberia retornar 401; un schema zod parseando
 *   la response de error habria detectado el mismatch de status).
 * - Caza "Field missing or wrong type" bugs en responses (e.g. fecha en
 *   string vs Date, int vs string).
 * - Caza "API accepts invalid body" bugs cuando se usa en route handlers
 *   con .parse() (PR futuro, scope de este PR es tests-only).
 *
 * Por que NO zod para todo el codebase:
 * - Overhead runtime. Para CRUD internos donde el repo retorna rows
 *   tipados, no necesitamos zod.
 * - Zod es mejor cuando el boundary es externo (HTTP, FormData, etc).
 *
 * Uso en tests:
 *   import { djiFlightSchema, errorResponseSchema } from "@/lib/api-schemas";
 *   const data = djiFlightSchema.array().parse(await res.json());
 *   expect(data[0].id).toBe(1);
 *
 * Si la response no matchea, `parse()` tira ZodError con detalle del
 * path que fallo. Mas explicito que `expect(res.status).toBe(200)` solo.
 */

import { z } from "zod";

// ============================================================
// Errores — shape { error: string } en todas las API routes
// ============================================================

export const errorResponseSchema = z.object({
  error: z.string()
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ============================================================
// DJI Flights (Fase 2/5 — PR #49 endpoint)
// ============================================================

export const djiFlightSchema = z.object({
  id: z.number().int().positive(),
  flight_id: z.number().int().positive(),
  drone_serial: z.string().nullable(),
  drone_nickname: z.string().nullable(),
  pilot_name: z.string().nullable(),
  start_at: z.string(), // ISO timestamptz
  end_at: z.string(),
  duration_seconds: z.number().int().nonnegative(),
  area_m2: z.string().nullable(), // numeric → string
  spray_usage_ml: z.number().int().nullable(),
  lng: z.string().nullable(),
  lat: z.string().nullable()
});
export type DjiFlightApi = z.infer<typeof djiFlightSchema>;

export const djiFlightListResponseSchema = z.object({
  flights: z.array(djiFlightSchema)
});
export type DjiFlightListResponse = z.infer<typeof djiFlightListResponseSchema>;

// ============================================================
// Data Quality Invariants (Fase 4.4 — PR #46 endpoint)
// ============================================================

export const dataQualitySeveritySchema = z.enum(["info", "warning", "error"]);

export const dataQualityWarningCodeSchema = z.enum([
  "parcela_no_cliente",
  "parcela_no_finca",
  "parcela_sin_ciclo_activo",
  "fumigacion_sin_ciclo",
  "fumigacion_ciclo_cerrado",
  "ciclo_sin_eventos",
  "ciclo_sin_phase_rule",
  "parcela_data_stale"
]);

export const dataQualityWarningSchema = z.object({
  code: dataQualityWarningCodeSchema,
  severity: dataQualitySeveritySchema,
  message: z.string(),
  parcela_id: z.number().int().optional(),
  cycle_id: z.number().int().optional(),
  fumigation_id: z.number().int().optional()
});
export type DataQualityWarningApi = z.infer<typeof dataQualityWarningSchema>;

export const dataQualityInvariantsResponseSchema = z.object({
  warnings: z.array(dataQualityWarningSchema)
});
export type DataQualityInvariantsResponse = z.infer<
  typeof dataQualityInvariantsResponseSchema
>;

// ============================================================
// Auth / Session — usado en tests de Bug 2 y auth-gated endpoints
// ============================================================

/**
 * Shape que NextAuth expone en `auth.user` despues de `authorized()`.
 * Si el session es null, `auth` es null (no tiene la propiedad .user).
 * Si esta shape no matchea, hay un bug en el flow de auth.
 */
export const authSessionUserSchema = z.object({
  // NextAuth v5 no garantiza un shape fijo de `user`; depende del provider.
  // Nuestro Credentials provider retorna { id, email, role }.
  id: z.union([z.string(), z.number()]).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "supervisor"]).optional(),
  name: z.string().optional()
});
export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;

export const authSessionSchema = z
  .object({
    user: authSessionUserSchema
  })
  .nullable();
export type AuthSession = z.infer<typeof authSessionSchema>;

// ============================================================
// Request Bodies — zod para validar POST/PUT/PATCH en route handlers
// ============================================================
//
// Sprint S11+ / Quality Gauntlet #1 PR #2 — zod para request bodies.
// Por que:
//   - Antes: cada route handler tenia 30-200 lineas de if-checks
//     manuales para validar body (tipos, formatos, rangos). Replicado
//     en 10+ endpoints. Bugs tipicos: "string vacio pasa como 0",
//     "undefined → null inesperado", "string > max length pasa".
//   - Despues: 1 schema por endpoint. Bugs se manifiestan como
//     ZodError con path exacto. Un test del schema cubre 12 paths
//     en 30 lineas (vs 200 de if-checks).
//
// Por que NO zod para bodies internos (lib/, scripts/):
//   - Overhead runtime. Para data tipada de repos, no aporta.
//   - Zod es mejor cuando el boundary es externo (HTTP, FormData).
//
// Por que mantenemos el shape de error 400 igual:
//   - { error: "mensaje humano" } — preserva compat con tests existentes.
//   - { issues: [{ path, message }] } — agregado como opcional, no rompe.
//   - El helper `formatZodIssues()` convierte ZodError → string legible.

// --- Reusable primitives ----------------------------------------

/**
 * String opcional: `undefined`/`null`/`""` → `null`. Trim y max length.
 * El body puede traer el campo como `""` para "clear" — zod lo trata
 * como null para que la BD no rechace por NOT NULL ni guarde string vacio.
 */
function optionalString(max: number) {
  return z.preprocess(
    (v) => (v === undefined || v === null ? null : v),
    z.string().trim().max(max).nullable()
  ).transform((v) => (v === "" ? null : v));
}

/**
 * Numero opcional: `undefined`/`null` → `null`. Acepta 0 (no es "missing").
 */
function optionalNonnegativeNumber() {
  return z.preprocess(
    (v) => (v === undefined || v === null ? null : v),
    z.number().finite().nonnegative().nullable()
  ).transform((v) => v as number | null);
}

/**
 * Entero positivo opcional: `undefined`/`null` → `null`. No acepta 0.
 */
function optionalPositiveInt() {
  return z.preprocess(
    (v) => (v === undefined || v === null ? null : v),
    z.number().int().positive().nullable()
  ).transform((v) => v as number | null);
}

/**
 * Fecha en formato YYYY-MM-DD. El Postgres DATE valida el resto
 * (mes 13 → 22008 invalid_datetime_format → 400 via el catch del route).
 */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "formato YYYY-MM-DD");

// --- POST /api/admin/clients ------------------------------------

export const createClientBodySchema = z.object({
  name: z.string().trim().min(1, "name es obligatorio").max(200),
  notes: optionalString(2000),
  created_by_email: z.string().min(1, "created_by_email es obligatorio")
});
export type CreateClientBody = z.infer<typeof createClientBodySchema>;

// --- POST /api/admin/farms --------------------------------------

export const createFarmBodySchema = z.object({
  client_id: z.number().int().positive("client_id es obligatorio y positivo"),
  name: z.string().trim().min(1, "name es obligatorio").max(200),
  municipality: optionalString(100),
  department: optionalString(100),
  created_by_email: z.string().min(1, "created_by_email es obligatorio")
});
export type CreateFarmBody = z.infer<typeof createFarmBodySchema>;

// --- POST /api/admin/fumigations --------------------------------

/**
 * Body del endpoint principal de registro manual de fumigaciones.
 * Campos requeridos: parcel_id, fumigation_date, product_used, dose_l_per_ha.
 * `recorded_by` se inyecta server-side desde la sesión — NO esta en el
 * schema (si viniera, zod lo rechazaria con "unrecognized key" si uso
 * `.strict()` — pero por ahora es `.object()` que ignora extras).
 */
export const createFumigationBodySchema = z.object({
  parcel_id: z.number().int().positive("parcel_id requerido (entero positivo)"),
  fumigation_date: dateString,
  product_used: z.string().trim().min(1).max(200),
  dose_l_per_ha: z.number().finite().positive().max(1000),
  area_fumigated_m2: optionalNonnegativeNumber(),
  duration_minutes: optionalNonnegativeNumber(),
  drone_code_used: optionalPositiveInt(),
  notes: optionalString(2000),
  product_registered_ica: optionalString(50),
  pilot_license: optionalString(20),
  product_id: optionalPositiveInt(),
  category_id: optionalPositiveInt(),
  application_type_id: optionalPositiveInt(),
  vehicle_plate: z.preprocess(
    (v) => (v === undefined || v === null ? null : v),
    z.string().trim().toUpperCase().nullable()
  ).refine(
    (v) => v === null || v === "" || /^[A-Z0-9-]{3,12}$/.test(v),
    { message: "vehicle_plate inválido. Formato: letras mayúsculas, números y guiones, 3-12 caracteres." }
  ).transform((v) => (v === "" ? null : v))
});
export type CreateFumigationBody = z.infer<typeof createFumigationBodySchema>;

// --- Validation error response shape ----------------------------

/**
 * Shape de respuesta 400 cuando zod rechaza el body.
 * `error` es un mensaje humano (primer issue). `issues` (opcional) es
 * la lista completa de problemas con path — util para clientes que
 * quieran resaltar campos en el form.
 */
export const validationErrorResponseSchema = z.object({
  error: z.string(),
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string()
      })
    )
    .optional()
});
export type ValidationErrorResponse = z.infer<
  typeof validationErrorResponseSchema
>;

// ============================================================
// Helper: parseWithSchema — fail-fast wrapper para tests
// ============================================================

/**
 * Helper para tests: parsea `await res.json()` con un schema zod y
 * devuelve el resultado tipado. Tira ZodError con detalle si no matchea.
 *
 * Ejemplo:
 *   const data = await parseWithSchema(res, errorResponseSchema);
 *   expect(data.error).toMatch(/no autenticado/);
 */
export async function parseWithSchema<T extends z.ZodTypeAny>(
  res: Response,
  schema: T
): Promise<z.infer<T>> {
  const json = await res.json();
  return schema.parse(json);
}

/**
 * Convierte un ZodError a un mensaje humano + lista de issues.
 * El primer issue es el mas probable que el usuario quiera ver;
 * la lista completa esta disponible para clientes que la necesiten.
 *
 * Ejemplo:
 *   const result = createFumigationBodySchema.safeParse(body);
 *   if (!result.success) {
 *     return NextResponse.json(formatZodIssues(result.error), { status: 400 });
 *   }
 */
export function formatZodIssues(error: z.ZodError): ValidationErrorResponse {
  const issues = error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "number" ? p : String(p))),
    message: i.message
  }));
  // El "first" issue es el mas util para el usuario final.
  const first = issues[0];
  const errorMsg = first
    ? `${first.path.join(".") || "body"}: ${first.message}`
    : "body inválido";
  return { error: errorMsg, issues };
}
