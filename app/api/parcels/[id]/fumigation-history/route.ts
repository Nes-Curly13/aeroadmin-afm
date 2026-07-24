/**
 * GET /api/parcels/[id]/fumigation-history?year=YYYY
 *
 * Sprint G2 — Hoja de vida completa.
 *
 * Devuelve el resumen anual de fumigaciones de una parcela para un año
 * dado. Usado por `components/parcels/parcel-fumigation-history.tsx`
 * cuando el usuario cambia el selector de año (no recarga la page, solo
 * hace fetch del año nuevo).
 *
 * Auth: el server-side page que carga el parcel (app/parcels/[id]/page.tsx)
 * valida que el viewer está logueado (via el middleware Edge). Este
 * endpoint también exige sesión admin/supervisor por defensa en
 * profundidad: un usuario con cookie pero sin rol 'admin' o
 * 'supervisor' no debería poder inspeccionar fumigaciones de
 * parcelas ajenas.
 *
 * Query params:
 *   - year: int, default CURRENT_DATE's year (Bogota TZ, no UTC)
 *
 * Respuesta: { summary: MonthlySummary[], totals: YearTotals }
 */

import { NextRequest, NextResponse } from "next/server";

import {
  getFumigationYearlySummary,
  getFumigationYearTotals
} from "@/api/repositories";
import { requireRole } from "@/lib/auth/role";
import { parseIntParam } from "@/lib/request";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole(["admin", "supervisor"]);

  const { id: rawId } = await params;
  const parcelId = Number(rawId);
  if (!Number.isFinite(parcelId) || parcelId < 1) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // year default = año actual del server (UTC). Bogota TZ offset no
  // cambia el año de la fumigación típica (el supervisor opera de día)
  // así que usar UTC es aceptable. Si querés exactitud TZ, ver
  // getBogotaDateString en lib/format.
  const currentYear = new Date().getUTCFullYear();
  const yearParam = parseIntParam(
    req.nextUrl.searchParams.get("year") ?? String(currentYear),
    "year",
    2000,
    2100
  );
  if ("error" in yearParam) {
    return NextResponse.json({ error: yearParam.error }, { status: 400 });
  }

  const [summary, totals] = await Promise.all([
    getFumigationYearlySummary(parcelId, yearParam.value),
    getFumigationYearTotals(parcelId, yearParam.value)
  ]);

  return NextResponse.json({ summary, totals });
}
