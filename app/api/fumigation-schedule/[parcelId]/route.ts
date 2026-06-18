import { NextRequest, NextResponse } from "next/server";

import { setFumigationCadence } from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/fumigation-schedule/[parcelId]
 * Body: { recommended_cadence_days: number }
 * Crea el schedule si no existe, lo actualiza si existe.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ parcelId: string }> }
) {
  try {
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
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al actualizar cadencia."
      },
      { status: 500 }
    );
  }
}
