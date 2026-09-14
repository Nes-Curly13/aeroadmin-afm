/**
 * POST /api/admin/cycles/[id]/close
 *
 * Cierra el ciclo activo (setea `end_date`) y registra un `cycle_event`
 * tipo 'harvest' (fecha de corte). Admin-only.
 *
 * Body: { end_date: "YYYY-MM-DD" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { closeCycle, createCycleEvent } from "@/api/repositories";
import { clientSafeErrorMessage } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const cycleId = Number(id);
  if (!Number.isInteger(cycleId) || cycleId <= 0) {
    return NextResponse.json({ error: "id de ciclo inválido" }, { status: 400 });
  }

  let body: { end_date?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* body vacío */
  }
  const endDate = body.end_date;
  if (typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json(
      { error: "end_date es obligatorio con formato YYYY-MM-DD" },
      { status: 400 }
    );
  }

  try {
    const cycle = await closeCycle(cycleId, endDate);
    if (!cycle) {
      return NextResponse.json({ error: "ciclo no encontrado" }, { status: 404 });
    }
    // Evento de corte (best-effort).
    await createCycleEvent({
      cycle_id: cycleId,
      event_type: "harvest",
      event_date: endDate
    }).catch(() => {});
    return NextResponse.json({ cycle });
  } catch (err) {
    const message = clientSafeErrorMessage(
      err,
      "error al cerrar el ciclo",
      "POST /api/admin/cycles/[id]/close"
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
