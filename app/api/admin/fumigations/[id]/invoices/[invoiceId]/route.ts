/**
 * PATCH /api/admin/fumigations/[id]/invoices/[invoiceId]
 *
 * Marca una factura como cancelada (soft cancel). NO borra el row
 * de la BD — la factura queda con `cancelled = TRUE` para auditoría.
 * El `cancelled_at` y `cancelled_by` quedan con el valor del primer
 * cancel (idempotente: si ya estaba cancelada, no hace UPDATE).
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
 *
 * Por qué solo cancelación (no edición de número/monto):
 *   El UNIQUE constraint (fumigation_id, invoice_number) previene
 *   correcciones de número. Si el operador escribió mal el número,
 *   tiene que cancelar la factura y crear una nueva. Para el monto,
 *   aplicaría la misma lógica — es más simple, menos surface area
 *   de bugs (cambiar montos a posteriori rompe auditoría contable).
 *
 * Auth: role=admin OR role=supervisor.
 *
 * Body: {} (no se necesita body; el cancel es por path).
 * Opcionalmente: { reason?: string } para guardar un motivo en el futuro
 * (no implementado — fuera de scope PR-C).
 *
 * Respuestas:
 *   200 + { invoice: FumigationInvoice } — cancelada OK o no-op idempotente
 *   401 / 403 — auth
 *   404 + { error: "factura no encontrada" } — id inválido
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import { cancelFumigationInvoice } from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
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

  // 2) Validar ids
  const { id, invoiceId } = await params;
  const fumigationId = Number(id);
  const invId = Number(invoiceId);
  if (!Number.isFinite(fumigationId) || !Number.isInteger(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "fumigation id inválido" }, { status: 400 });
  }
  if (!Number.isFinite(invId) || !Number.isInteger(invId) || invId <= 0) {
    return NextResponse.json({ error: "invoiceId inválido" }, { status: 400 });
  }

  // 3) Email del session user
  const session = await auth();
  const cancelledBy = session?.user?.email ?? "unknown@aeroadmin.local";

  // 4) Cancel
  try {
    const invoice = await cancelFumigationInvoice(invId, cancelledBy);
    if (!invoice) {
      return NextResponse.json({ error: "factura no encontrada" }, { status: 404 });
    }
    // Sanity: la factura debe pertenecer a la fumigación del path
    if (invoice.fumigation_id !== fumigationId) {
      return NextResponse.json(
        { error: "la factura no pertenece a esta fumigación" },
        { status: 404 }
      );
    }
    return NextResponse.json({ invoice }, { status: 200 });
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json(
      { error: e.message ?? "error interno" },
      { status: 500 }
    );
  }
}
