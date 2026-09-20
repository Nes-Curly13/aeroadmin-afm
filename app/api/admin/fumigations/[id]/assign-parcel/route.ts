/**
 * POST /api/admin/fumigations/[id]/assign-parcel
 *
 * 2026-09-20 — asigna una parcela a una fumigación HUÉRFANA
 * (`needs_parcel_assignment = true`, `parcel_id IS NULL`) creada por el
 * import por-sesión de vuelos DJI. Ver `docs/HANDOFF-2026-09-20.md` §3.
 *
 * Body (JSON):
 *   { parcel_id: number }   // entero positivo, parcela existente
 *
 * Efectos:
 *   - `dji_fumigations.parcel_id = parcel_id`
 *   - `needs_parcel_assignment = false`, `assignment_note = NULL`
 *   - propaga `parcel_id` a los `dji_flights` de la fumigación sin parcela
 *
 * Auth: role=admin OR role=supervisor (mismo gate que POST/PATCH).
 *
 * Respuestas:
 *   200 + { fumigation } — asignada OK
 *   400 + { error } — id/parcel_id inválidos o parcela inexistente
 *   401 / 403 — auth
 *   404 + { error: "fumigación no encontrada" } — no existe/soft-deleted
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { assignFumigationParcel, getFumigationById } from "@/api/repositories";
import { recordFumigationEdit } from "@/lib/fumigation-audit";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || !Number.isInteger(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  const parcelId = (raw as { parcel_id?: unknown } | null)?.parcel_id;
  if (
    typeof parcelId !== "number" ||
    !Number.isInteger(parcelId) ||
    parcelId <= 0
  ) {
    return NextResponse.json(
      { error: "parcel_id debe ser entero positivo" },
      { status: 400 }
    );
  }

  try {
    const before = await getFumigationById(fumigationId);
    if (!before) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    const updated = await assignFumigationParcel(fumigationId, parcelId);
    if (!updated) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }

    const session = await auth();
    const actorEmail = session?.user?.email ?? "unknown@aeroadmin.local";
    await recordFumigationEdit(before, updated, actorEmail);

    return NextResponse.json({ fumigation: updated }, { status: 200 });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "PARCEL_NOT_FOUND") {
      return NextResponse.json({ error: "parcela no encontrada" }, { status: 400 });
    }
    if (e.code === "23503") {
      return NextResponse.json({ error: "parcela no existe" }, { status: 400 });
    }
    return NextResponse.json({ error: e.message ?? "error interno" }, { status: 500 });
  }
}
