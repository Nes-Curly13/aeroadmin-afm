/**
 * POST /api/admin/fumigations
 *
 * Endpoint para que el operador fumigador registre una fumigación
 * MANUAL (no escrapeda de DJI). Cierra el gap #1 del QA review
 * 2026-08-02: antes de este endpoint, el operador no podía
 * registrar una fumigación que DJI no había reportado (e.g. una
 * aplicación de herbicida manual, una fumigación fuera del rango
 * de fechas que DJI sincroniza, o un re-tratamiento). La única
 * forma era correr INSERT INTO dji_fumigations … desde SQL.
 *
 * Auth: role=admin OR role=supervisor. Ambos perfiles pueden
 * registrar fumigaciones operativas (es la operatoria normal
 * del campo). El "no admin" de la URL viene del hecho de que la
 * fumigación NO es metadata de parcela (que sí es admin-only).
 *
 * Sprint 2026-08-02 — feature/manual-fumigation-ui.
 *
 * Body (JSON, todos los campos opcionales excepto parcel_id,
 * fumigation_date, product_used y dose_l_per_ha):
 *   {
 *     parcel_id: number (required),
 *     fumigation_date: string YYYY-MM-DD (required),
 *     product_used: string (required, ej. "Glifosato 48%"),
 *     dose_l_per_ha: number (required, ej. 2.5),
 *     area_fumigated_m2: number? (opcional),
 *     duration_minutes: number? (opcional),
 *     drone_code_used: number? (código del dron usado),
 *     notes: string? (notas operativas),
 *     product_registered_ica: string? (ej "ICA-1234-PN", ICA
 *       compliance — opcional pero recomendado para auditoría),
 *     pilot_license: string? (ej "PCA-12345", Aerocivil
 *       compliance — opcional pero recomendado)
 *   }
 *
 * `recorded_by` se setea server-side con el email del usuario
 * actual (de la sesión). El cliente NO puede inyectarlo.
 *
 * Respuestas:
 *   201 + { fumigation: DjiFumigationEvent } — creado OK
 *   400 + { error: string, issues?: [...] } — body inválido (zod)
 *                              o el repo falló (e.g. CHECK constraint
 *                              violation del ICA license, parcel no existe)
 *   401 / 403 — auth (requireRole)
 *   503 — BD caída
 *
 * Sprint S11+ / zod PR #2 — body validation via createFumigationBodySchema
 * (lib/api-schemas.ts). Reemplaza 200+ lineas de parseAndValidate().
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { createFumigationEvent } from "@/api/repositories";
import { recordFumigationCreate } from "@/lib/fumigation-audit";
import {
  createFumigationBodySchema,
  formatZodIssues,
  type CreateFumigationBody
} from "@/lib/api-schemas";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1) Auth: admin o supervisor (ambos pueden registrar fumigaciones).
  // El "no admin" de la URL es por la convención del codebase (todos
  // los endpoints viven bajo /api/admin/*), no porque sea admin-only.
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  // 2) Body parsing + validación via zod (PR #2)
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON invalido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const parsed = createFumigationBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodIssues(parsed.error), { status: 400 });
  }
  const data: CreateFumigationBody = parsed.data;

  // 3) `recorded_by` se inyecta server-side desde la sesión. NO
  // confiamos en un valor que venga del body (user podría hacer
  // curl y atribuir la fumigación a otro).
  const session = await auth();
  const recordedBy = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Crear el evento. La BD valida:
  //    - parcel existe (FK)
  //    - product_registered_ica matches `^[A-Z0-9-]{3,50}$` si no es null
  //    - pilot_license matches `^[A-Z0-9-]{4,20}$` si no es null
  // Si el INSERT falla, mapeamos el error a 400 (es un problema
  // de input, no del server). 23514 = check_violation, 23503 =
  // foreign_key_violation (parcel no existe).
  try {
    const fumigation = await createFumigationEvent({
      parcel_id: data.parcel_id,
      fumigation_date: data.fumigation_date,
      product_used: data.product_used,
      dose_l_per_ha: data.dose_l_per_ha,
      area_fumigated_m2: data.area_fumigated_m2,
      duration_minutes: data.duration_minutes,
      drone_code_used: data.drone_code_used,
      notes: data.notes,
      product_registered_ica: data.product_registered_ica,
      pilot_license: data.pilot_license,
      product_id: data.product_id,
      category_id: data.category_id,
      application_type_id: data.application_type_id,
      vehicle_plate: data.vehicle_plate,
      recorded_by: recordedBy
    });
    // Audit log: registramos la creación. Fire-and-forget — si falla,
    // la fumigación ya quedó persistida y el cliente recibe 201.
    // Sprint 2026-08-15 — feature/fumigation-audit-log / sub-2.
    await recordFumigationCreate(fumigation, recordedBy);
    return NextResponse.json({ fumigation }, { status: 201 });
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    // Errores de constraint de la BD → 400 con mensaje claro.
    if (pgErr.code === "23514") {
      return NextResponse.json(
        { error: `CHECK violation: ${pgErr.message ?? "formato invalido"}` },
        { status: 400 }
      );
    }
    if (pgErr.code === "23503") {
      return NextResponse.json(
        { error: `FK violation: ${pgErr.message ?? "parcel_id no existe"}` },
        { status: 400 }
      );
    }
    if (pgErr.code === "23502") {
      return NextResponse.json(
        { error: `NOT NULL violation: ${pgErr.message ?? "campo requerido"}` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: pgErr.message ?? "error interno" },
      { status: 500 }
    );
  }
}
