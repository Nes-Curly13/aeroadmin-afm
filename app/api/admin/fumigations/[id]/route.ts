/**
 * PATCH /api/admin/fumigations/[id]
 *
 * Endpoint para que el operador fumigador EDITE una fumigación existente.
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-3.
 *
 * Cierra el pedido del operador de poder editar fumigaciones una a una
 * (no bulk). Antes de este endpoint, la única forma era UPDATE directo
 * en SQL, o borrar + re-crear (perdiendo el id y la trazabilidad).
 *
 * Auth: role=admin OR role=supervisor (igual que el POST).
 *
 * Body (JSON, todos los campos opcionales — solo se actualizan los provistos):
 *   {
 *     fumigation_date?: string YYYY-MM-DD,
 *     product_used?: string | null,
 *     dose_l_per_ha?: number | null,
 *     area_fumigated_m2?: number | null,
 *     duration_minutes?: number | null,
 *     drone_code_used?: number | null,
 *     notes?: string | null,
 *     product_registered_ica?: string | null,
 *     pilot_license?: string | null,
 *     category_id?: number | null,
 *   }
 *
 * Campos INMUTABLES (no se aceptan, devuelven 400 si vienen):
 *   - parcel_id: cambiar el lote es una fumigación nueva, no edición.
 *   - source: provenance inmutable (manual | djiscraper | import).
 *   - recorded_by: el operador original. Si se reasignó, es una fumigación nueva.
 *   - flight_ids: asociación con vuelos DJI, solo la crea el importador.
 *   - recorded_at: timestamp original, no se edita.
 *   - deleted_at, deleted_by: soft-delete tiene su propio endpoint.
 *
 * Respuestas:
 *   200 + { fumigation: DjiFumigationEvent } — actualizado OK
 *   400 + { error: string } — body inválido, campo inmutable, o
 *                              repo falló (CHECK constraint, FK inválida)
 *   401 / 403 — auth (requireRole)
 *   404 + { error: "not found" } — fumigación no existe o soft-deleted
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { getFumigationById, getFumigationRawById, softDeleteFumigationEvent, updateFumigationEvent } from "@/api/repositories";
import { recordFumigationDelete, recordFumigationEdit } from "@/lib/fumigation-audit";

export const dynamic = "force-dynamic";

interface PatchFumigationBody {
  fumigation_date?: unknown;
  product_used?: unknown;
  dose_l_per_ha?: unknown;
  area_fumigated_m2?: unknown;
  duration_minutes?: unknown;
  drone_code_used?: unknown;
  notes?: unknown;
  product_registered_ica?: unknown;
  pilot_license?: unknown;
  category_id?: unknown;
  /**
   * Sprint S7 — application_type_id (FK a application_types). Ortogonal
   * a category_id. Opcional, integer positivo. La BD valida FK (23503
   * si no existe o está inactiva).
   */
  application_type_id?: unknown;
  /**
   * Sprint S7 / Fase 1 (PR-B) — placa del vehículo usado. Opcional.
   * null = clear; string = set. Validamos formato en el server
   * (CHECK regex en la BD también).
   */
  vehicle_plate?: unknown;
}

/** Type del patch normalizado (después de parseAndValidate). */
interface PatchFumigationData {
  fumigation_date?: string;
  product_used?: string | null;
  dose_l_per_ha?: number | null;
  area_fumigated_m2?: number | null;
  duration_minutes?: number | null;
  drone_code_used?: number | null;
  notes?: string | null;
  product_registered_ica?: string | null;
  pilot_license?: string | null;
  category_id?: number | null;
  application_type_id?: number | null;
  vehicle_plate?: string | null;
}

/** Campos que NO se pueden editar vía PATCH. Lista negra explícita. */
const IMMUTABLE_FIELDS = [
  "parcel_id",
  "source",
  "recorded_by",
  "flight_ids",
  "recorded_at",
  "deleted_at",
  "deleted_by"
] as const;

/**
 * Parsea y valida el body del PATCH. Devuelve el patch normalizado o
 * un string con el error. Reutiliza el mismo patrón de validación que
 * el POST (`app/api/admin/fumigations/route.ts`) pero con todos los
 * campos opcionales (PATCH es sparse update).
 */
function parseAndValidate(
  input: PatchFumigationBody
):
  | {
      ok: true;
      data: PatchFumigationData;
    }
  | { ok: false; error: string } {
  const data: PatchFumigationData = {};

  // fumigation_date: opcional. Si viene, formato YYYY-MM-DD.
  if (input.fumigation_date !== undefined) {
    if (
      typeof input.fumigation_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.fumigation_date)
    ) {
      return { ok: false, error: "fumigation_date debe ser string YYYY-MM-DD" };
    }
    data.fumigation_date = input.fumigation_date;
  }

  // product_used: opcional. Si viene, string no vacío (1-200).
  if (input.product_used !== undefined) {
    if (input.product_used === null) {
      data.product_used = null;
    } else if (
      typeof input.product_used !== "string" ||
      input.product_used.trim().length === 0 ||
      input.product_used.length > 200
    ) {
      return { ok: false, error: "product_used debe ser string no vacío (1-200 chars) o null" };
    } else {
      data.product_used = input.product_used.trim();
    }
  }

  // dose_l_per_ha: opcional. Si viene, number positivo, max 1000.
  if (input.dose_l_per_ha !== undefined) {
    if (input.dose_l_per_ha === null) {
      data.dose_l_per_ha = null;
    } else if (
      typeof input.dose_l_per_ha !== "number" ||
      !Number.isFinite(input.dose_l_per_ha) ||
      input.dose_l_per_ha <= 0 ||
      input.dose_l_per_ha > 1000
    ) {
      return { ok: false, error: "dose_l_per_ha debe ser número positivo (max 1000) o null" };
    } else {
      data.dose_l_per_ha = input.dose_l_per_ha;
    }
  }

  // Numericos opcionales con default 0
  const numOpt = (
    v: unknown,
    field: string,
    max: number
  ): number | null | { err: string } => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
      return { err: `${field} debe ser número >= 0 (max ${max}) o null` };
    }
    return v;
  };
  if (input.area_fumigated_m2 !== undefined) {
    const r = numOpt(input.area_fumigated_m2, "area_fumigated_m2", 1e12);
    if (typeof r === "object" && r && "err" in r) return { ok: false, error: r.err };
    data.area_fumigated_m2 = r as number | null;
  }
  if (input.duration_minutes !== undefined) {
    const r = numOpt(input.duration_minutes, "duration_minutes", 100_000);
    if (typeof r === "object" && r && "err" in r) return { ok: false, error: r.err };
    data.duration_minutes = r as number | null;
  }
  if (input.drone_code_used !== undefined) {
    if (input.drone_code_used === null) {
      data.drone_code_used = null;
    } else if (
      typeof input.drone_code_used !== "number" ||
      !Number.isInteger(input.drone_code_used) ||
      input.drone_code_used <= 0
    ) {
      return { ok: false, error: "drone_code_used debe ser entero positivo o null" };
    } else {
      data.drone_code_used = input.drone_code_used;
    }
  }

  // Strings opcionales con trim
  const strOpt = (
    v: unknown,
    field: string,
    max: number
  ): string | null | { err: string } => {
    if (v === null) return null;
    if (typeof v !== "string") return { err: `${field} debe ser string o null` };
    const t = v.trim();
    if (t.length === 0) return null; // '' → null (clear)
    if (t.length > max) return { err: `${field} debe tener max ${max} caracteres` };
    return t;
  };
  if (input.notes !== undefined) {
    const r = strOpt(input.notes, "notes", 2000);
    if (typeof r === "object" && r && "err" in r) return { ok: false, error: r.err };
    data.notes = r as string | null;
  }
  if (input.product_registered_ica !== undefined) {
    const r = strOpt(input.product_registered_ica, "product_registered_ica", 50);
    if (typeof r === "object" && r && "err" in r) return { ok: false, error: r.err };
    data.product_registered_ica = r as string | null;
  }
  if (input.pilot_license !== undefined) {
    const r = strOpt(input.pilot_license, "pilot_license", 20);
    if (typeof r === "object" && r && "err" in r) return { ok: false, error: r.err };
    data.pilot_license = r as string | null;
  }

  // category_id: opcional. Si viene, integer positivo (la BD valida FK).
  if (input.category_id !== undefined) {
    if (input.category_id === null) {
      data.category_id = null;
    } else if (
      typeof input.category_id !== "number" ||
      !Number.isInteger(input.category_id) ||
      input.category_id <= 0
    ) {
      return { ok: false, error: "category_id debe ser entero positivo o null" };
    } else {
      data.category_id = input.category_id;
    }
  }

  // Sprint S7 — application_type_id: opcional. Si viene, integer
  // positivo (la BD valida FK). Ortogonal a category_id.
  if (input.application_type_id !== undefined) {
    if (input.application_type_id === null) {
      data.application_type_id = null;
    } else if (
      typeof input.application_type_id !== "number" ||
      !Number.isInteger(input.application_type_id) ||
      input.application_type_id <= 0
    ) {
      return {
        ok: false,
        error: "application_type_id debe ser entero positivo o null"
      };
    } else {
      data.application_type_id = input.application_type_id;
    }
  }

  // Sprint S7 / Fase 1 (PR-B) — vehicle_plate: opcional. Si viene,
  // string (formato CHECK) o null (clear). Server normaliza a UPPER.
  if (input.vehicle_plate !== undefined) {
    if (input.vehicle_plate === null) {
      data.vehicle_plate = null;
    } else if (typeof input.vehicle_plate !== "string") {
      return { ok: false, error: "vehicle_plate debe ser string o null" };
    } else {
      const t = input.vehicle_plate.trim().toUpperCase();
      if (t.length === 0) {
        data.vehicle_plate = null;
      } else if (!/^[A-Z0-9-]{3,12}$/.test(t)) {
        return {
          ok: false,
          error:
            "vehicle_plate inválido. Formato: letras mayúsculas, números y guiones, 3-12 caracteres."
        };
      } else {
        data.vehicle_plate = t;
      }
    }
  }

  return { ok: true, data };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) Auth: admin o supervisor.
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

  // 2) Validar id
  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || !Number.isInteger(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 3) Body parsing
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }

  // 4) Rechazar campos inmutables (lista negra explícita)
  for (const field of IMMUTABLE_FIELDS) {
    if (field in (raw as Record<string, unknown>)) {
      return NextResponse.json(
        { error: `campo inmutable: ${field} (use POST para crear una fumigación nueva)` },
        { status: 400 }
      );
    }
  }

  // 5) Validar y normalizar
  const parsed = parseAndValidate(raw as PatchFumigationBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  // session requerida por requireRole arriba; el cast es seguro.
  void (await auth());

  // 6) Update
  try {
    // Audit log: capturamos el "before" antes del update para poder
    // computar la diff. Si la fumigación no existe (404), este
    // getFumigationById devuelve null y no llegamos al UPDATE.
    // Sprint 2026-08-15 — feature/fumigation-audit-log / sub-2.
    const before = await getFumigationById(fumigationId);
    if (!before) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    const updated = await updateFumigationEvent(fumigationId, parsed.data);
    if (!updated) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    // Registrar la edición en el audit log. Fire-and-forget: si falla,
    // logueamos warning pero no rompemos el 200 (la fumigación ya
    // quedó actualizada). Si la diff está vacía (caller mandó un patch
    // pero ningún campo cambió), recordFumigationEdit devuelve false
    // y no inserta nada.
    const session = await auth();
    const actorEmail = session?.user?.email ?? "unknown@aeroadmin.local";
    await recordFumigationEdit(before, updated, actorEmail);

    return NextResponse.json({ fumigation: updated }, { status: 200 });
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === "23514") {
      return NextResponse.json(
        { error: `CHECK violation: ${pgErr.message ?? "formato inválido"}` },
        { status: 400 }
      );
    }
    if (pgErr.code === "23503") {
      return NextResponse.json(
        {
          error: `FK violation: ${
            pgErr.message ?? "category_id o application_type_id no existe"
          }`
        },
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

/**
 * DELETE /api/admin/fumigations/[id]
 *
 * Soft-delete de una fumigación. Marca `deleted_at = NOW()` y
 * `deleted_by = session.email`. La fumigación sigue en la BD para
 * auditoría pero desaparece de /fumigaciones y de los listados
 * relacionados (timeline del parcel, dashboard, etc.).
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
 *
 * Auth: role=admin OR role=supervisor. Mismo gate que POST/PATCH.
 *
 * Idempotente: si la fumigación ya está soft-deleted, devuelve 200
 * con la fumigación tal cual (no error). Esto simplifica el cliente
 * (no necesita checkear antes de delete).
 *
 * Respuestas:
 *   200 + { fumigation: DjiFumigationEvent } — soft-delete OK
 *   400 + { error: "id inválido" } — id mal formado
 *   401 / 403 — auth
 *   404 + { error: "fumigación no encontrada" } — no existe
 *   500 — error interno
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1) Auth
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

  // 2) Validar id
  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || !Number.isInteger(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 3) Email del session user para `deleted_by`. Si por alguna razón
  // no hay session (raro: requireRole ya pasó), usamos unknown.
  const session = await auth();
  const deletedBy = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Soft-delete
  try {
    // Audit log: capturamos before (raw para detectar si ya estaba
    // soft-deleted) y after (raw para tener el row con deleted_at
    // seteado). `getFumigationById` filtra soft-deleted y no nos sirve
    // para el after-state. Sprint 2026-08-15 — sub-2.
    const before = await getFumigationRawById(fumigationId);
    if (!before) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    const result = await softDeleteFumigationEvent(fumigationId, deletedBy);
    if (!result) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    // Re-fetch con `getFumigationRawById` (no filtra deleted_at) para
    // obtener el row con `deleted_at`/`deleted_by` seteados. El `result`
    // del softDelete viene de `getFumigationById` que filtra y devuelve
    // null en fumigaciones soft-deleted.
    const after = await getFumigationRawById(fumigationId);
    if (after) {
      await recordFumigationDelete(before, after, deletedBy);
    }

    return NextResponse.json({ fumigation: result }, { status: 200 });
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json(
      { error: e.message ?? "error interno" },
      { status: 500 }
    );
  }
}
