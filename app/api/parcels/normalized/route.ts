import { NextRequest, NextResponse } from "next/server";

import { getParcelsNormalized, getParcelsSummary } from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * GET /api/parcels/normalized
 *
 * Modelo Opción B: 1 fila por parcela con columnas planas.
 * Filtros opcionales via query string:
 *   - isOrchard=true|false
 *   - droneModelCode=72|201|210
 *   - minSprayAreaM2=1000
 *   - fieldType=Farmland|Orchards
 *
 * Si se pasa ?summary=1 devuelve el resumen agregado por dron.
 */
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const wantSummary = url.searchParams.get("summary") === "1";

    if (wantSummary) {
      const summary = await getParcelsSummary();
      return NextResponse.json({ data: summary });
    }

    const pageParam = parseIntParam(url.searchParams.get("page") ?? "1", "page", 1);
    const limitParam = parseIntParam(url.searchParams.get("limit") ?? "20", "limit", 1, 100);

    if (pageParam.error) {
      return NextResponse.json({ error: pageParam.error }, { status: 400 });
    }
    if (limitParam.error) {
      return NextResponse.json({ error: limitParam.error }, { status: 400 });
    }

    const filter: {
      isOrchard?: boolean;
      droneModelCode?: number;
      minSprayAreaM2?: number;
      fieldType?: string;
    } = {};

    const isOrchardRaw = url.searchParams.get("isOrchard");
    if (isOrchardRaw === "true") filter.isOrchard = true;
    else if (isOrchardRaw === "false") filter.isOrchard = false;

    const droneRaw = url.searchParams.get("droneModelCode");
    if (droneRaw && /^\d+$/.test(droneRaw)) {
      filter.droneModelCode = Number(droneRaw);
    }

    const minAreaRaw = url.searchParams.get("minSprayAreaM2");
    if (minAreaRaw && /^\d+(\.\d+)?$/.test(minAreaRaw)) {
      filter.minSprayAreaM2 = Number(minAreaRaw);
    }

    const fieldTypeRaw = url.searchParams.get("fieldType");
    if (fieldTypeRaw) {
      filter.fieldType = fieldTypeRaw;
    }

    const result = await getParcelsNormalized(pageParam.value, limitParam.value, filter);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch normalized parcels."
      },
      { status: 500 }
    );
  }
}
