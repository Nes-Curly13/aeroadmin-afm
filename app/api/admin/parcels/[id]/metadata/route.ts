/**
 * PATCH /api/admin/parcels/[id]/metadata
 *
 * Sprint S8.2 (2026-07-29): endpoint admin para que el operador fumigador
 * pueda poblar los 4 campos V0 (`client_name`, `farm_name`, `municipality`,
 * `variety`) via UI en `/admin/parcels`.
 *
 * Authorization: solo role=admin. Los supervisores no pueden editar
 * metadata de parcelas (pueden registrar fumigaciones propias pero no
 * renombrar fincas). El gate de /admin/* en `lib/auth.config.ts` ya
 * filtra la UI; acá filtramos el endpoint para que no se pueda bypassear
 * con curl.
 *
 * Body: ParcelMetadataUpdate parcial (cualquier subset de los 11 campos
 * editables). Solo los campos presentes en el body se actualizan — el
 * resto queda intacto. El repo (`updateParcelMetadata`) valida longitudes
 * y tipos antes del UPDATE.
 *
 * Respuestas:
 *   200 + { parcel: DjiParcelRecord } — update OK, devuelve el row nuevo
 *   400 + { error: string }            — body inválido (JSON malformado,
 *                                        tipo incorrecto, validación del
 *                                        repo falló — `client_name max
 *                                        200 chars` etc.)
 *   401 / 403 — auth (requireRole)
 *   404 + { error: "parcel not found" } — id no existe
 *   503 — BD caída (withLocalFallback tira)
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { updateParcelMetadata, type ParcelMetadataUpdate } from "@/api/repositories";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const EDITABLE_FIELDS = [
  "land_name",
  "field_type",
  "declared_area_ha",
  "spray_area_m2",
  "crop_type",
  "planting_date",
  "owner_name",
  "owner_contact",
  "supervisor_notes",
  "client_name",
  "farm_name",
  "municipality",
  "variety"
] as const;

function pickEditable(input: Record<string, unknown>): ParcelMetadataUpdate {
  const out: ParcelMetadataUpdate = {};
  for (const k of EDITABLE_FIELDS) {
    if (k in input) {
      // Permitir null explícito para "borrar este campo" (e.g. clear farm_name).
      // Mantener `undefined` como "no tocar este campo".
      out[k] = input[k] as never;
    }
  }
  return out;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  // requireRole lanza errores tipados (code='UNAUTHENTICATED' | 'FORBIDDEN')
  // que tenemos que traducir a 401/403. Si NO los capturamos aca,
  // Next.js los convierte en 500 (unhandled exception en route handler).
  // v2.5.1 (S8.4): user story test 7.3 (RBAC supervisor) fallo con
  //   500 en lugar de 403. Fix abajo.
  try {
    await requireRole("admin");
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body JSON invalido" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }

  const patch = pickEditable(body);
  const editableKeys = Object.keys(patch);
  if (editableKeys.length === 0) {
    return NextResponse.json(
      { error: "body vacio — incluir al menos un campo editable" },
      { status: 400 }
    );
  }

  try {
    const parcel = await updateParcelMetadata(id, patch);
    if (!parcel) {
      return NextResponse.json({ error: "parcel no existe" }, { status: 404 });
    }
    return NextResponse.json({ parcel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    // Validaciones del repo (e.g. "client_name max 200 chars") caen acá.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
