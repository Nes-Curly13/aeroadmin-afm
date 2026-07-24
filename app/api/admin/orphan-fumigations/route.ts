/**
 * GET /api/admin/orphan-fumigations
 *
 * Sprint G1 — Hoja de vida de la parcela.
 *
 * Lista paginada de fumigaciones huérfanas (parcel_id IS NULL). Las
 * huérfanas vienen del backfill `backfill-fumigations-from-flights`
 * cuando el spatial join no encontró una parcela para el flight. NO
 * tienen geometría (no se persiste flight_id en dji_fumigations), así
 * que el admin las revisa y las vincula manualmente via
 * `POST /api/fumigations/[id]/link`.
 *
 * Solo accesible para role 'admin' (gates de seguridad: el endpoint
 * expone metadata operacional, no datos del cliente, pero igual
 * limitamos por defensa en profundidad).
 *
 * Query params:
 *   - limit: int, default 25, max 100
 *   - offset: int, default 0
 *
 * Respuesta: { rows: DjiFumigationEvent[], total: number, limit: number, offset: number }
 */

import { NextRequest, NextResponse } from "next/server";

import { getOrphanFumigations } from "@/api/repositories";
import { requireRole } from "@/lib/auth/role";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await requireRole("admin");

  const limitParam = parseIntParam(
    req.nextUrl.searchParams.get("limit") ?? "25",
    "limit",
    1,
    100
  );
  if ("error" in limitParam) {
    return NextResponse.json({ error: limitParam.error }, { status: 400 });
  }
  const offsetParam = parseIntParam(
    req.nextUrl.searchParams.get("offset") ?? "0",
    "offset",
    0
  );
  if ("error" in offsetParam) {
    return NextResponse.json({ error: offsetParam.error }, { status: 400 });
  }

  const { rows, total } = await getOrphanFumigations(limitParam.value, offsetParam.value);
  return NextResponse.json({ rows, total, limit: limitParam.value, offset: offsetParam.value });
}
