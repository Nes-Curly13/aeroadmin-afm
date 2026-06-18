import { NextResponse } from "next/server";

import { getUpcomingFumigations } from "@/api/repositories";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

/**
 * GET /api/fumigations/upcoming?limit=10
 * Devuelve las parcelas ordenadas por urgencia de fumigación:
 *   overdue (más viejo primero) → due_soon → ok → no_history
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit") ?? "10";
    const parsed = parseIntParam(rawLimit, "limit", 1, 200);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const rows = await getUpcomingFumigations(parsed.value);
    return NextResponse.json({ data: rows, total: rows.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error al obtener próximas fumigaciones."
      },
      { status: 500 }
    );
  }
}
