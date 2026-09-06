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
