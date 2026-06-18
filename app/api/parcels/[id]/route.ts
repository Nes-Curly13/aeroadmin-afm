import { NextRequest, NextResponse } from "next/server";

import { getParcelById } from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * GET /api/parcels/[id]
 *
 * Devuelve una sola parcela con todas sus geometrías como GeoJSON.
 * 404 si no existe.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const parsed = parseIntParam(rawId, "id", 1);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const parcel = await getParcelById(parsed.value);
    if (!parcel) {
      return NextResponse.json({ error: "Parcela no encontrada." }, { status: 404 });
    }
    return NextResponse.json({ data: parcel });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al obtener la parcela."
      },
      { status: 500 }
    );
  }
}
