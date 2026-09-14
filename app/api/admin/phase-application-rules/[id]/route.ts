/**
 * /api/admin/phase-application-rules/[id]
 *   PATCH  → actualiza campos (parcial)
 *   DELETE → elimina
 * Admin-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  updatePhaseApplicationRule,
  deletePhaseApplicationRule
} from "@/api/repositories";
import { clientSafeErrorMessage } from "@/lib/api-error";
import type { PhaseApplicationRuleInput } from "@/lib/phase-application-defaults";

export const dynamic = "force-dynamic";

function authResponse(err: unknown): NextResponse {
  const code = err && typeof err === "object" && "code" in err
    ? (err as { code?: string }).code
    : undefined;
  if (code === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  if (code === "FORBIDDEN") {
    return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
  }
  return NextResponse.json({ error: "auth error" }, { status: 500 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authResponse(err);
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  const patch: Partial<PhaseApplicationRuleInput> = {};
  if (typeof body.phase === "string") patch.phase = body.phase;
  if (typeof body.category_slug === "string") patch.category_slug = body.category_slug;
  if (body.application_type_slug !== undefined) {
    patch.application_type_slug =
      typeof body.application_type_slug === "string" && body.application_type_slug.trim()
        ? body.application_type_slug.trim()
        : null;
  }
  if (body.cadence_days !== undefined) {
    patch.cadence_days =
      body.cadence_days == null || body.cadence_days === ""
        ? null
        : Number(body.cadence_days);
  }
  if (body.window_from_day !== undefined) patch.window_from_day = Number(body.window_from_day);
  if (body.window_to_day !== undefined) patch.window_to_day = Number(body.window_to_day);
  if (body.is_required !== undefined) patch.is_required = Boolean(body.is_required);
  if (body.notes !== undefined) {
    patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }

  try {
    const rule = await updatePhaseApplicationRule(id, patch);
    if (!rule) return NextResponse.json({ error: "regla no encontrada" }, { status: 404 });
    return NextResponse.json({ rule });
  } catch (err) {
    return NextResponse.json(
      { error: clientSafeErrorMessage(err, "error al actualizar la regla") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authResponse(err);
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  try {
    const ok = await deletePhaseApplicationRule(id);
    if (!ok) return NextResponse.json({ error: "regla no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: clientSafeErrorMessage(err, "error al eliminar la regla") },
      { status: 500 }
    );
  }
}
