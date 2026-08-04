/**
 * PATCH /api/admin/parcels/[id]/geometry
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 *
 * Reemplaza la geometría de una parcela. Usado cuando el operador
 * fumigador re-dibuja el polígono en `/admin/parcels/[id]`.
 *
 * Decisión QA 2026-08-04: la geometría es EDITABLE con warning.
 *   - El backend loguea el cambio en `djiag_audit_log` (best-effort).
 *   - La fumigación pasada NO se migra (queda asociada a la geom
 *     anterior). El detalle de la parcela muestra la nueva forma.
 *
 * Authorization: solo role=admin. Mismo gate que POST.
 *
 * Body:
 *   - `geometry`: GeoJSON Polygon o MultiPolygon (obligatorio)
 *   - `change_reason`: string explicando por qué se re-dibujó
 *     (obligatorio para auditoría, max 500 chars)
 *
 * Respuestas:
 *   200 + { parcel: DjiParcelRecord } — update OK
 *   400 + { error: string }            — body inválido o CHECK
 *   401 / 403 — auth
 *   404 — parcel no existe
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  updateParcelGeometry,
  type ManualParcelGeometry
} from "@/api/repositories";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireRole("admin");
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

  const geometry = body.geometry as ManualParcelGeometry | undefined;
  const changeReason = body.change_reason;
  if (typeof changeReason !== "string" || changeReason.trim().length === 0) {
    return NextResponse.json(
      { error: "change_reason es obligatorio para auditoría" },
      { status: 400 }
    );
  }
  if (changeReason.length > 500) {
    return NextResponse.json(
      { error: "change_reason max 500 chars" },
      { status: 400 }
    );
  }

  try {
    const parcel = await updateParcelGeometry(id, geometry as ManualParcelGeometry, changeReason);
    if (!parcel) {
      return NextResponse.json({ error: "parcel no existe" }, { status: 404 });
    }
    return NextResponse.json({ parcel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
