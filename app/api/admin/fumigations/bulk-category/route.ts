/**
 * POST /api/admin/fumigations/bulk-category
 *
 * Update en bulk de la categoría (`category_id`) de N fumigaciones.
 * Acepta `null` para limpiar la categoría. Cada fumigación afectada
 * se registra en audit con action = "edited" y diff `{ category_id }`.
 *
 * Sprint 2026-08-29 — feature/bloque-f-bulk-operations.
 *
 * Auth: role=admin OR role=supervisor (mismo gate que PATCH individual).
 *
 * Body (JSON):
 *   {
 *     ids: number[],            // array de ids, min 1, max 200
 *     category_id: number | null,  // id de FUMIGATION_CATEGORIES, o null
 *   }
 *
 * Respuestas:
 *   200 + { updated: number, skipped: number, affected_ids: number[] }
 *   400 + { error: string } — body inválido, ids vacío o > 200,
 *                              category_id no es entero positivo o null
 *   401 / 403 — auth
 *   500 — error interno
 *
 * Decisiones:
 *   - category_id = null está permitido (limpia la categoría, deja
 *     la fumigación "Sin clasificar"). El operador fumigador lo usa
 *     cuando se equivocó de categoría y prefiere "sin clasificar"
 *     antes que otra categoría incorrecta.
 *   - category_id inválido (no existe en fumigation_categories) se
 *     delega a la BD: el UPDATE con FK inválida devuelve 23503, que
 *     el caller mapea a 400. Sin embargo, el bulk UPDATE con ANY($1)
 *     NO falla entero si un id es inválido — falla solo las filas
 *     con FK inválida. Para evitar esto, validamos contra el
 *     catálogo en server antes del UPDATE.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import {
  bulkUpdateFumigationCategory,
  insertFumigationAuditEvent
} from "@/api/repositories";
import { fumigationAuditDiff } from "@/lib/fumigation-audit";
import { FUMIGATION_CATEGORIES } from "@/lib/data-constants";

export const dynamic = "force-dynamic";

const MAX_BULK_SIZE = 200;

interface BulkCategoryBody {
  ids?: unknown;
  category_id?: unknown;
}

export async function POST(req: Request) {
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
  const body = raw as BulkCategoryBody;

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
  const ids: number[] = [];
  for (const id of body.ids) {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: `id inválido: ${String(id)} (debe ser entero positivo)` },
        { status: 400 }
      );
    }
    ids.push(id);
  }
  const uniqueIds = Array.from(new Set(ids));

  // category_id: null es válido (clear). Si viene, debe ser int positivo
  // y existir en el catálogo curado.
  let categoryId: number | null;
  if (body.category_id === null) {
    categoryId = null;
  } else if (
    typeof body.category_id !== "number" ||
    !Number.isInteger(body.category_id) ||
    body.category_id <= 0
  ) {
    return NextResponse.json(
      { error: "category_id debe ser entero positivo o null" },
      { status: 400 }
    );
  } else {
    const exists = FUMIGATION_CATEGORIES.some((c) => c.id === body.category_id);
    if (!exists) {
      return NextResponse.json(
        {
          error: `category_id ${body.category_id} no existe en el catálogo. Válidos: ${FUMIGATION_CATEGORIES.map((c) => c.id).join(", ")}`
        },
        { status: 400 }
      );
    }
    categoryId = body.category_id;
  }

  // 3) Email del session user
  const session = await auth();
  const actorEmail = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Update en bulk
  try {
    const result = await bulkUpdateFumigationCategory(uniqueIds, categoryId);

    // 5) Audit log: un INSERT por fumigación afectada.
    // El repo ya devuelve el `category_id` ANTERIOR en `oldCategoryId`,
    // así que no necesitamos un SELECT extra por fumigación.
    // El `after.category_id` es el input `categoryId`.
    if (result.affected.length > 0) {
      await Promise.all(
        result.affected.map(async ({ id, oldCategoryId }) => {
          try {
            // Diff solo del campo que cambió (category_id).
            const d = fumigationAuditDiff(
              { category_id: oldCategoryId },
              { category_id: categoryId }
            );
            if (Object.keys(d).length === 0) return;
            await insertFumigationAuditEvent({
              fumigation_id: id,
              action: "edited",
              actor_email: actorEmail,
              changes: {
                diff: d,
                bulk: true
              }
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn(
              `[bulk-category] failed to record audit for fumigation_id=${id} (no-op, la fumigación ya quedó actualizada):`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
    }

    return NextResponse.json(
      {
        updated: result.affected.length,
        skipped: result.skippedIds.length,
        affected_ids: result.affected.map((a) => a.id),
        skipped_ids: result.skippedIds
      },
      { status: 200 }
    );
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === "23503") {
      return NextResponse.json(
        { error: `FK violation: ${pgErr.message ?? "category_id no existe"}` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: pgErr.message ?? "error interno" },
      { status: 500 }
    );
  }
}
