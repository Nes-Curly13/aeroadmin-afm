import { NextRequest, NextResponse } from "next/server";

import { setFumigationCadence } from "@/api/repositories";
import { requireRole } from "@/lib/auth/role";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/fumigation-schedule/[parcelId]
 * Body: { recommended_cadence_days: number }
 * Crea el schedule si no existe, lo actualiza si existe.
 *
 * v1.5: guard de role. La cadencia es una decisión de negocio del admin
 * (define cada cuánto se fumiga cada parcela). Un supervisor NO debe poder
 * modificar la cadencia — puede registrar fumigaciones reales (POST
 * /api/fumigations), pero no reprogramar la frecuencia esperada.
 *
 * Mismo patrón que POST /api/fumigations: `requireRole` antes de validar
 * body, errores tipados (UNAUTHENTICATED -> 401, FORBIDDEN -> 403)
 * traducidos en el catch.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ parcelId: string }> }
) {
  try {
    // Guard de role (v1.5). Admin only — la cadencia es decisión de negocio.
    await requireRole("admin");

    const { parcelId: rawId } = await params;
    const idParsed = parseIntParam(rawId, "parcelId", 1);
    if ("error" in idParsed) {
      return NextResponse.json({ error: idParsed.error }, { status: 400 });
    }
    const body = (await request.json()) as { recommended_cadence_days?: unknown };
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.recommended_cadence_days !== "number"
    ) {
      return NextResponse.json(
        { error: "Body debe incluir recommended_cadence_days (number)." },
        { status: 400 }
      );
    }
    await setFumigationCadence(idParsed.value, body.recommended_cadence_days);
    return NextResponse.json({ ok: true });
  } catch (error) {
    // Traducción de errores tipados de `requireRole` (v1.4 Track A).
    // Mismo patrón que POST /api/fumigations y change-password.
    const code = (error as { code?: string }).code;
    if (code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 });
    }
    if (code === "FORBIDDEN") {
      return NextResponse.json(
        { error: "Solo administradores pueden editar la cadencia." },
        { status: 403 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al actualizar cadencia."
      },
      { status: 500 }
    );
  }
}
