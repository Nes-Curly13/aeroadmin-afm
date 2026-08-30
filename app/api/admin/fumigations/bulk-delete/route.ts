/**
 * POST /api/admin/fumigations/bulk-delete
 *
 * Soft-delete en bulk de N fumigaciones. Cada id se marca con
 * `deleted_at = NOW()` y `deleted_by = session.email`. Se registra
 * UN evento de audit por fumigación afectada (action = "deleted")
 * con snapshot del row antes del delete.
 *
 * Sprint 2026-08-29 — feature/bloque-f-bulk-operations.
 *
 * Auth: role=admin OR role=supervisor (mismo gate que DELETE individual).
 *
 * Body (JSON):
 *   { ids: number[] }  — array de ids, min 1, max 200 por request
 *                        (cap razonable para no atascar al cliente ni
 *                        a la BD; si necesitan más, mandan 2 requests).
 *
 * Respuestas:
 *   200 + { deleted: number, skipped: number, affected_ids: number[] }
 *       — siempre 200, salvo errores de validación (la operación es
 *         idempotente y los skips se reportan en `skipped`).
 *   400 + { error: string } — body inválido, ids vacío, o > 200
 *   401 / 403 — auth (requireRole)
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import {
  bulkSoftDeleteFumigations,
  insertFumigationAuditEvent
} from "@/api/repositories";
import { fumigationAuditSnapshot } from "@/lib/fumigation-audit";

export const dynamic = "force-dynamic";

const MAX_BULK_SIZE = 200;

interface BulkDeleteBody {
  ids?: unknown;
}

export async function POST(req: Request) {
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

  // 2) Body parsing
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const body = raw as BulkDeleteBody;
  if (!Array.isArray(body.ids)) {
    return NextResponse.json(
      { error: "ids debe ser un array de enteros positivos" },
      { status: 400 }
    );
  }
  if (body.ids.length === 0) {
    return NextResponse.json(
      { error: "ids no puede estar vacío (min 1 fumigación)" },
      { status: 400 }
    );
  }
  if (body.ids.length > MAX_BULK_SIZE) {
    return NextResponse.json(
      { error: `ids excede el máximo (${MAX_BULK_SIZE} por request)` },
      { status: 400 }
    );
  }
  // Validar tipos
  const ids: number[] = [];
  for (const id of body.ids) {
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return NextResponse.json(
        { error: `id inválido: ${String(id)} (debe ser entero positivo)` },
        { status: 400 }
      );
    }
    ids.push(id);
  }
  // Deduplicar manteniendo el orden (mismo id dos veces = 1 sola op).
  const uniqueIds = Array.from(new Set(ids));

  // 3) Email del session user
  const session = await auth();
  const deletedBy = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Soft-delete en bulk
  try {
    const result = await bulkSoftDeleteFumigations(uniqueIds, deletedBy);

    // 5) Audit log: un INSERT por fumigación afectada. El repo ya
    // devolvió el `before` (snapshot pre-delete) en `affected[]`,
    // así que NO necesitamos un SELECT extra por fumigación.
    //
    // Fire-and-forget por fumigación: si una falla, no rompemos el
    // batch (las otras ya se borraron). Logueamos warning a stderr.
    if (result.affected.length > 0) {
      await Promise.all(
        result.affected.map(async ({ id, before }) => {
          try {
            await insertFumigationAuditEvent({
              fumigation_id: id,
              action: "deleted",
              actor_email: deletedBy,
              changes: {
                snapshot: fumigationAuditSnapshot(before),
                bulk: true
              }
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[bulk-delete] failed to record audit for fumigation_id=${id} (no-op, la fumigación ya quedó borrada):`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
    }

    return NextResponse.json(
      {
        deleted: result.affected.length,
        skipped: result.skippedIds.length,
        affected_ids: result.affected.map((a) => a.id),
        skipped_ids: result.skippedIds
      },
      { status: 200 }
    );
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json(
      { error: e.message ?? "error interno" },
      { status: 500 }
    );
  }
}
