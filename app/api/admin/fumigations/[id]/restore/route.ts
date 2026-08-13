/**
 * POST /api/admin/fumigations/[id]/restore
 *
 * Restaura una fumigación soft-deleted (un-delete). Limpia `deleted_at`
 * y `deleted_by`. La fumigación vuelve a aparecer en listados, timeline
 * y reportes.
 *
 * Sprint 2026-08-13 — feature/fumigaciones-detail-polish.
 *
 * Auth: role=admin OR role=supervisor (mismo gate que DELETE).
 *
 * Idempotente: si la fumigación NO está soft-deleted, devuelve 200 con
 * la fumigación tal cual (no-op). Si NO existe (ni siquiera soft-deleted),
 * devuelve 404.
 *
 * No tiene UI. El admin lo invoca via curl si borra por error:
 *   curl -X POST https://aeroadmin.local/api/admin/fumigations/123/restore
 *
 * Decisión: usamos POST y no PATCH porque la acción es semánticamente
 * un "event" (cambiar el estado de deleted), no un update parcial de
 * campos. Es consistente con el patrón REST de acciones (POST a
 * /resource/[id]/action).
 *
 * Respuestas:
 *   200 + { fumigation: DjiFumigationEvent } — restaurada OK o no-op
 *   401 / 403 — auth
 *   404 + { error: "fumigación no encontrada" } — no existe
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { restoreFumigationEvent } from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function POST(
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
  if (!Number.isFinite(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 3) Email del session user para auditoría (console.log en repo).
  const session = await auth();
  const restoredBy = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Restore (con try/catch para devolver JSON 500 consistente)
  try {
    const result = await restoreFumigationEvent(fumigationId, restoredBy);
    if (!result) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
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
