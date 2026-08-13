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
 *   400 + { error: string } — body inválido, falta campo
 *                              requerido, o el repo falló
 *                              (e.g. CHECK constraint violation
 *                              del ICA license, parcel no existe)
 *   401 / 403 — auth (requireRole)
 *   503 — BD caída
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { createFumigationEvent } from "@/api/repositories";

export const dynamic = "force-dynamic";

interface CreateFumigationBody {
  parcel_id?: unknown;
  fumigation_date?: unknown;
  product_used?: unknown;
  dose_l_per_ha?: unknown;
  area_fumigated_m2?: unknown;
  duration_minutes?: unknown;
  drone_code_used?: unknown;
  notes?: unknown;
  product_registered_ica?: unknown;
  pilot_license?: unknown;
  /**
   * Categoría curada (FK a fumigation_categories). Opcional — la
   * fumigación puede existir sin categoría (caso histórico o
   * operador que no la conoce). Validamos que sea integer positivo
   * y que la categoría exista + esté activa.
   * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-2.
   */
  category_id?: unknown;
}

/**
 * Valida y normaliza el body. Devuelve el objeto normalizado o
 * un string con el error. Esta función NO toca la BD — la
 * validación final (parcel existe, ICA formato, etc.) la hace
 * `createFumigationEvent` + el CHECK de la BD.
 *
 * Mantenemos la validación acá para devolver 400 con mensajes
 * claros al usuario (la BD tira 23514 "check_violation" sin
 * contexto, horrible para UX).
 */
function parseAndValidate(
  input: CreateFumigationBody
):
  | {
      ok: true;
      data: {
        parcel_id: number;
        fumigation_date: string;
        product_used: string;
        dose_l_per_ha: number;
        area_fumigated_m2: number | null;
        duration_minutes: number | null;
        drone_code_used: number | null;
        notes: string | null;
        product_registered_ica: string | null;
        pilot_license: string | null;
        category_id: number | null;
        recorded_by: string;
      };
    }
  | { ok: false; error: string } {
  // parcel_id: required, positive integer
  if (typeof input.parcel_id !== "number" || !Number.isInteger(input.parcel_id) || input.parcel_id <= 0) {
    return { ok: false, error: "parcel_id requerido (entero positivo)" };
  }
  // fumigation_date: required, formato YYYY-MM-DD
  if (typeof input.fumigation_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.fumigation_date)) {
    return { ok: false, error: "fumigation_date requerido (formato YYYY-MM-DD)" };
  }
  // product_used: required, no vacío, max 200 chars
  if (
    typeof input.product_used !== "string" ||
    input.product_used.trim().length === 0 ||
    input.product_used.length > 200
  ) {
    return { ok: false, error: "product_used requerido (1-200 caracteres)" };
  }
  // dose_l_per_ha: required, positive number, max 1000
  if (
    typeof input.dose_l_per_ha !== "number" ||
    !Number.isFinite(input.dose_l_per_ha) ||
    input.dose_l_per_ha <= 0 ||
    input.dose_l_per_ha > 1000
  ) {
    return { ok: false, error: "dose_l_per_ha requerido (número positivo, max 1000)" };
  }
  // Opcionales
  const area =
    input.area_fumigated_m2 === null || input.area_fumigated_m2 === undefined
      ? null
      : typeof input.area_fumigated_m2 === "number" &&
          Number.isFinite(input.area_fumigated_m2) &&
          input.area_fumigated_m2 >= 0
        ? input.area_fumigated_m2
        : null;
  if (
    input.area_fumigated_m2 !== null &&
    input.area_fumigated_m2 !== undefined &&
    area === null
  ) {
    return { ok: false, error: "area_fumigated_m2 debe ser número >= 0 o null" };
  }
  const dur =
    input.duration_minutes === null || input.duration_minutes === undefined
      ? null
      : typeof input.duration_minutes === "number" &&
          Number.isFinite(input.duration_minutes) &&
          input.duration_minutes >= 0
        ? input.duration_minutes
        : null;
  if (
    input.duration_minutes !== null &&
    input.duration_minutes !== undefined &&
    dur === null
  ) {
    return { ok: false, error: "duration_minutes debe ser número >= 0 o null" };
  }
  const drone =
    input.drone_code_used === null || input.drone_code_used === undefined
      ? null
      : typeof input.drone_code_used === "number" &&
          Number.isInteger(input.drone_code_used) &&
          input.drone_code_used > 0
        ? input.drone_code_used
        : null;
  if (
    input.drone_code_used !== null &&
    input.drone_code_used !== undefined &&
    drone === null
  ) {
    return { ok: false, error: "drone_code_used debe ser entero positivo o null" };
  }
  // category_id: opcional, integer positivo. La BD valida FK al
  // insertar (23503 si no existe). No hacemos lookup acá para no
  // sumar una query — la BD es la fuente de verdad del catálogo.
  let category: number | null = null;
  if (input.category_id !== null && input.category_id !== undefined) {
    if (
      typeof input.category_id !== "number" ||
      !Number.isInteger(input.category_id) ||
      input.category_id <= 0
    ) {
      return { ok: false, error: "category_id debe ser entero positivo o null" };
    }
    category = input.category_id;
  }
  // Strings opcionales: trim, max length (defensa contra inputs gigantes
  // antes de llegar a la BD)
  const trim = (v: unknown, max: number, field: string): string | null | { err: string } => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") return { err: `${field} debe ser string o null` };
    const t = v.trim();
    if (t.length === 0) return null; // '' → null (clear)
    if (t.length > max) return { err: `${field} debe tener max ${max} caracteres` };
    return t;
  };
  const notesRes = trim(input.notes, 2000, "notes");
  if (typeof notesRes === "object" && notesRes && "err" in notesRes) {
    return { ok: false, error: notesRes.err };
  }
  const icaRes = trim(input.product_registered_ica, 50, "product_registered_ica");
  if (typeof icaRes === "object" && icaRes && "err" in icaRes) {
    return { ok: false, error: icaRes.err };
  }
  const licenseRes = trim(input.pilot_license, 20, "pilot_license");
  if (typeof licenseRes === "object" && licenseRes && "err" in licenseRes) {
    return { ok: false, error: licenseRes.err };
  }

  return {
    ok: true,
    data: {
      parcel_id: input.parcel_id,
      fumigation_date: input.fumigation_date,
      product_used: input.product_used.trim(),
      dose_l_per_ha: input.dose_l_per_ha,
      area_fumigated_m2: area,
      duration_minutes: dur,
      drone_code_used: drone,
      notes: notesRes as string | null,
      product_registered_ica: icaRes as string | null,
      pilot_license: licenseRes as string | null,
      category_id: category,
      recorded_by: "" // se setea después con la sesión
    }
  };
}

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

  // 2) Body parsing + validación
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON invalido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const parsed = parseAndValidate(raw as CreateFumigationBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

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
      ...parsed.data,
      recorded_by: recordedBy
    });
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
