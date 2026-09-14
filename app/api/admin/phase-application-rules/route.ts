/**
 * /api/admin/phase-application-rules
 *
 * CRUD admin de las reglas de aplicación por fase (data-driven, MVP
 * fenológico). Admin-only.
 *   GET    ?cropType=cana   → lista
 *   POST                     → crea una regla
 *   (PATCH/DELETE en /[id], reset en /reset)
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  getPhaseApplicationRules,
  createPhaseApplicationRule
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

export async function GET(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authResponse(err);
  }
  const crop = new URL(request.url).searchParams.get("cropType") ?? "cana";
  try {
    const rules = await getPhaseApplicationRules(crop);
    return NextResponse.json({ rules });
  } catch (err) {
    return NextResponse.json(
      { error: clientSafeErrorMessage(err, "error al listar reglas") },
      { status: 500 }
    );
  }
}

function parseBody(b: Record<string, unknown>): PhaseApplicationRuleInput | string {
  const crop = typeof b.crop_type === "string" && b.crop_type.trim() ? b.crop_type.trim() : "cana";
  const phase = typeof b.phase === "string" ? b.phase : "";
  const category = typeof b.category_slug === "string" ? b.category_slug : "";
  if (!phase) return "phase es obligatorio";
  if (!category) return "category_slug es obligatorio";
  const from = Number(b.window_from_day);
  const to = Number(b.window_to_day);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return "window_from_day/window_to_day inválidos (from >= 0 y to >= from)";
  }
  const cadence = b.cadence_days == null || b.cadence_days === "" ? null : Number(b.cadence_days);
  if (cadence !== null && (!Number.isInteger(cadence) || cadence <= 0)) {
    return "cadence_days debe ser entero positivo o null";
  }
  return {
    crop_type: crop,
    phase,
    category_slug: category,
    application_type_slug:
      typeof b.application_type_slug === "string" && b.application_type_slug.trim()
        ? b.application_type_slug.trim()
        : null,
    cadence_days: cadence,
    window_from_day: from,
    window_to_day: to,
    is_required: b.is_required !== false,
    notes: typeof b.notes === "string" && b.notes.trim() ? b.notes.trim() : null
  };
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
    return authResponse(err);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "body JSON inválido" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "body debe ser un objeto" }, { status: 400 });
  }
  const parsed = parseBody(raw as Record<string, unknown>);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  try {
    const rule = await createPhaseApplicationRule(parsed);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: clientSafeErrorMessage(err, "error al crear la regla") },
      { status: 500 }
    );
  }
}
