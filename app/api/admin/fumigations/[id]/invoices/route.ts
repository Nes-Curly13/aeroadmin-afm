/**
 * POST /api/admin/fumigations/[id]/invoices
 *
 * Crea una factura para una fumigación. La fumigación puede tener
 * N facturas (cuotas, pagos parciales, anulaciones con re-factura).
 * El UNIQUE constraint (fumigation_id, invoice_number) previene
 * duplicados a nivel de BD.
 *
 * Sprint S7 — feature/s7-schema-extension / Fase 1 / PR-C.
 *
 * Auth: role=admin OR role=supervisor.
 *
 * Body esperado:
 *   {
 *     invoice_number: string (1-50 chars, requerido)
 *     invoiced_at:    string (YYYY-MM-DD, requerido)
 *     amount_cop:     number (>= 0, requerido)
 *   }
 *
 * Respuestas:
 *   201 + { invoice: FumigationInvoice } — creada OK
 *   400 + { error: "..." } — body inválido o CHECK violation
 *   401 / 403 — auth
 *   404 + { error: "fumigación no encontrada" } — fumigación no existe
 *     o está soft-deleted
 *   409 + { error: "duplicate invoice_number" } — UNIQUE violation
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  createFumigationInvoice,
  getFumigationById
} from "@/api/repositories";
import type { FumigationInvoice } from "@/lib/types";

export const dynamic = "force-dynamic";

interface CreateInvoiceBody {
  invoice_number?: unknown;
  invoiced_at?: unknown;
  amount_cop?: unknown;
}

function parseAndValidate(
  input: CreateInvoiceBody
):
  | { ok: true; data: { invoice_number: string; invoiced_at: string; amount_cop: number } }
  | { ok: false; error: string } {
  // invoice_number: required, 1-50 chars
  if (
    typeof input.invoice_number !== "string" ||
    input.invoice_number.trim().length === 0
  ) {
    return { ok: false, error: "invoice_number requerido" };
  }
  const invNum = input.invoice_number.trim();
  if (invNum.length > 50) {
    return { ok: false, error: "invoice_number max 50 caracteres" };
  }
  // invoiced_at: required, YYYY-MM-DD
  if (
    typeof input.invoiced_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.invoiced_at)
  ) {
    return { ok: false, error: "invoiced_at requerido (YYYY-MM-DD)" };
  }
  // amount_cop: required, number >= 0
  if (
    typeof input.amount_cop !== "number" ||
    !Number.isFinite(input.amount_cop) ||
    input.amount_cop < 0
  ) {
    return { ok: false, error: "amount_cop requerido (número >= 0)" };
  }
  return { ok: true, data: { invoice_number: invNum, invoiced_at: input.invoiced_at, amount_cop: input.amount_cop } };
}

export async function POST(
  req: Request,
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
  if (!Number.isFinite(fumigationId) || !Number.isInteger(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // 3) Body parsing
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const parsed = parseAndValidate(raw as CreateInvoiceBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // 4) Verificar que la fumigación existe y no está soft-deleted.
  // Sin esto, una factura "huérfana" (FK a fumigación borrada) se crearía
  // silenciosamente vía FK CASCADE si la fumigación tiene el row.
  const fum = await getFumigationById(fumigationId);
  if (!fum) {
    return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
  }

  // 5) INSERT
  try {
    const invoice: FumigationInvoice = await createFumigationInvoice({
      fumigation_id: fumigationId,
      invoice_number: parsed.data.invoice_number,
      invoiced_at: parsed.data.invoiced_at,
      amount_cop: parsed.data.amount_cop
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    const pgErr = err as { code?: string; message?: string };
    if (pgErr.code === "23505") {
      // UNIQUE violation (fumigation_id, invoice_number)
      return NextResponse.json(
        { error: "ya existe una factura con ese número para esta fumigación" },
        { status: 409 }
      );
    }
    if (pgErr.code === "23514") {
      return NextResponse.json(
        { error: `CHECK violation: ${pgErr.message ?? "formato inválido"}` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: pgErr.message ?? "error interno" },
      { status: 500 }
    );
  }
}
