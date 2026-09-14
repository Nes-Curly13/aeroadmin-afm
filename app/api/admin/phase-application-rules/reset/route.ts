/**
 * POST /api/admin/phase-application-rules/reset
 *
 * Restaura los valores RECOMENDADOS de `phase_application_rules` para un
 * cultivo (borra los del crop y re-inserta los defaults del código).
 * Admin-only. Body opcional: { crop_type?: "cana" }
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { resetPhaseApplicationRules } from "@/api/repositories";
import { clientSafeErrorMessage } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireRole("admin");
  } catch (err) {
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

  let crop = "cana";
  try {
    const body = (await request.json()) as { crop_type?: unknown };
    if (typeof body.crop_type === "string" && body.crop_type.trim()) {
      crop = body.crop_type.trim();
    }
  } catch {
    /* body vacío → cana */
  }

  try {
    const count = await resetPhaseApplicationRules(crop);
    return NextResponse.json({ ok: true, rules: count });
  } catch (err) {
    return NextResponse.json(
      { error: clientSafeErrorMessage(err, "error al restaurar las reglas") },
      { status: 500 }
    );
  }
}
