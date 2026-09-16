/**
 * GET  /api/admin/fumigation-plans?status=&parcelId=&fromDate=&toDate=&limit=
 * POST /api/admin/fumigation-plans
 *
 * Planificación MANUAL de fumigaciones (2026-09-15). Reemplaza la
 * planificación auto-derivada de `phase_application_rules`: acá el
 * operador agenda planes a mano y el dashboard arranca vacío.
 *
 * Authorization: admin | supervisor (los fumigadores planifican y
 * registran). El gate de `/admin/*` protege la UI; acá protegemos el
 * endpoint para evitar bypass con curl.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/role";
import {
  listFumigationPlans,
  createFumigationPlan,
  type FumigationPlanStatus
} from "@/api/repositories";
import {
  createFumigationPlanBodySchema,
  formatZodIssues
} from "@/lib/api-schemas";
import { clientSafeErrorMessage } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const VALID_STATUS: readonly FumigationPlanStatus[] = [
  "planificada",
  "hecha",
  "cancelada"
];

export async function GET(request: NextRequest) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    return authErrorToResponse(err);
  }

  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const parcelIdRaw = url.searchParams.get("parcelId");
  const limitRaw = url.searchParams.get("limit");

  const status = statusRaw
    ? statusRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is FumigationPlanStatus =>
          (VALID_STATUS as readonly string[]).includes(s)
        )
    : undefined;
  const parcelId = parcelIdRaw ? Number(parcelIdRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const plans = await listFumigationPlans({
      status,
      parcelId:
        parcelId !== undefined && Number.isFinite(parcelId) && parcelId > 0
          ? parcelId
          : undefined,
      fromDate: url.searchParams.get("fromDate") ?? undefined,
      toDate: url.searchParams.get("toDate") ?? undefined,
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined
    });
    return NextResponse.json({ plans });
  } catch (err) {
    const message = clientSafeErrorMessage(
      err,
      "error al listar los planes",
      "GET /api/admin/fumigation-plans"
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    return authErrorToResponse(err);
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

  const parsed = createFumigationPlanBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodIssues(parsed.error), { status: 400 });
  }
  const b = parsed.data;

  // `created_by_email` se inyecta server-side desde la sesión (no se
  // confía en el body para auditoría).
  const session = await auth();
  const createdBy = session?.user?.email ?? null;

  try {
    const plan = await createFumigationPlan({
      parcel_id: b.parcel_id,
      planned_date: b.planned_date,
      category_id: b.category_id,
      application_type_id: b.application_type_id,
      product_name: b.product_name,
      notes: b.notes,
      created_by_email: createdBy
    });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (err) {
    // 23503 = FK violation (parcela/categoría/tipo inexistente)
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      return NextResponse.json(
        { error: "la parcela (o la categoría/tipo) no existe" },
        { status: 400 }
      );
    }
    const message = clientSafeErrorMessage(
      err,
      "error al crear el plan",
      "POST /api/admin/fumigation-plans"
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
