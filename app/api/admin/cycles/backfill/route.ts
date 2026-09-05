/**
 * POST /api/admin/cycles/backfill
 *
 * Sprint S11+ / PLAN-FUMIGACIONES-V2 / Fase 4.3 — Backfill híbrido.
 *
 * Crea ciclos virtuales a partir del historial de fumigaciones. Para
 * cada parcela, encuentra gaps > `gapDays` entre fumigaciones
 * consecutivas y crea un ciclo cubriendo el cluster (start_date =
 * primera fumigación, end_date = null, source='dji_inferred',
 * data_validity='needs_review'). El operador debe revisar cada uno
 * en el UI.
 *
 * Body: { gap_days?: number, default 120 }
 *
 * Idempotente? NO. Si se corre 2 veces, crea duplicados. El
 * operador debe correrlo UNA vez por environment y luego ir a
 * /admin/parcels a revisar los `needs_review`.
 *
 * Authorization: solo role=admin.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { backfillCyclesFromFumigations } from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorToResponse(err);
  }

  let body: { gap_days?: number } = {};
  try {
    const raw = await request.text();
    if (raw.length > 0) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body debe ser JSON válido" }, { status: 400 });
  }

  const gapDays = body.gap_days ?? 120;
  if (typeof gapDays !== "number" || !Number.isFinite(gapDays) || gapDays < 30 || gapDays > 365) {
    return NextResponse.json(
      { error: "gap_days debe ser número entre 30 y 365" },
      { status: 400 }
    );
  }

  try {
    const result = await backfillCyclesFromFumigations(gapDays);
    return NextResponse.json({
      ...result,
      message: `Backfill completo. ${result.cycles_created} ciclos nuevos marcados como needs_review. Operator debe ir a /admin/parcels y revisar.`
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json(
      { error: "error interno", detail: message },
      { status: 500 }
    );
  }
}

function authErrorToResponse(err: unknown): NextResponse {
  const code = err && typeof err === "object" && "code" in err
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
