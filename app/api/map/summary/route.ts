import { NextRequest, NextResponse } from "next/server";

import { getFumigationsSummary } from "@/api/repositories";

/**
 * GET /api/map/summary
 *
 * v2.0 (sprint S5) — endpoint para el `KpiPill` overlay del `/map`.
 * Devuelve agregados de fumigaciones (count, area_ha, volume_l, flights)
 * filtrados por un set opcional de `parcelIds` y rango `from`/`to`.
 *
 * Query params:
 *   - parcelIds: comma-separated (e.g. "1,2,3"). Opcional.
 *   - from: YYYY-MM-DD. Opcional.
 *   - to:   YYYY-MM-DD. Opcional.
 *
 * El cliente (`MapPageClient`) lo llama cuando el usuario mueve el
 * slider del `TimeRange` para recalcular los KPIs en vivo.
 *
 * Decisión: no usamos `unstable_cache` acá porque los filtros
 * (parcelIds+from+to) son únicos por sesión. Cachear no aporta.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const parcelIdsParam = url.searchParams.get("parcelIds");
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;

    const parcelIds = parcelIdsParam
      ? parcelIdsParam
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      : undefined;

    const summary = await getFumigationsSummary({ parcelIds, from, to });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
