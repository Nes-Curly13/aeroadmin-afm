/**
 * PATCH  /api/admin/fumigation-plans/:id  — editar / marcar hecha / cancelar
 * DELETE /api/admin/fumigation-plans/:id  — borrar un plan
 *
 * Planificación MANUAL de fumigaciones (2026-09-15).
 * Authorization: admin | supervisor.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  updateFumigationPlan,
  deleteFumigationPlan
} from "@/api/repositories";
import {
  updateFumigationPlanBodySchema,
  formatZodIssues
} from "@/lib/api-schemas";
import { clientSafeErrorMessage } from "@/lib/api-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    return authErrorToResponse(err);
  }

  const { id: idRaw } = await context.params;
  const id = parseId(idRaw);
  if (id === null) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "body debe ser JSON válido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }

  const parsed = updateFumigationPlanBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodIssues(parsed.error), { status: 400 });
  }

  try {
    const plan = await updateFumigationPlan(id, parsed.data);
    if (!plan) {
      return NextResponse.json({ error: "plan no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ plan });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      return NextResponse.json(
        { error: "la categoría/tipo (o la fumigación) no existe" },
        { status: 400 }
      );
    }
    const message = clientSafeErrorMessage(
      err,
      "error al actualizar el plan",
      "PATCH /api/admin/fumigation-plans/[id]"
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    return authErrorToResponse(err);
  }

  const { id: idRaw } = await context.params;
  const id = parseId(idRaw);
  if (id === null) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const ok = await deleteFumigationPlan(id);
    if (!ok) {
      return NextResponse.json({ error: "plan no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = clientSafeErrorMessage(
      err,
      "error al borrar el plan",
      "DELETE /api/admin/fumigation-plans/[id]"
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function authErrorToResponse(err: unknown): NextResponse {
  const code =
    err && typeof err === "object" && "code" in err
      ? (err as { code?: string }).code
      : undefined;
  if (code === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  if (code === "FORBIDDEN") {
    return NextResponse.json({ error: "sin permisos" }, { status: 403 });
  }
  return NextResponse.json({ error: "auth error" }, { status: 500 });
}
