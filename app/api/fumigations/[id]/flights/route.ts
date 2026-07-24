/**
 * GET /api/fumigations/[id]/flights
 *
 * Sprint G2 — Hoja de vida completa.
 *
 * Devuelve los dji_flights que originaron una fumigación del import
 * (los IDs están en dji_fumigations.flight_ids, persistidos por el
 * backfill Sprint G2).
 *
 * Auth: requiere sesión admin/supervisor. La fumigación puede ser
 * pública a esos roles, pero no a un viewer anónimo.
 *
 * Respuesta: { flights: FlightTraceRow[] } (puede ser [])
 */

import { NextRequest, NextResponse } from "next/server";

import { getFumigationFlightTrace } from "@/api/repositories";
import { requireRole } from "@/lib/auth/role";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole(["admin", "supervisor"]);

  const { id: rawId } = await params;
  const fumigationId = Number(rawId);
  if (!Number.isFinite(fumigationId) || fumigationId < 1) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const flights = await getFumigationFlightTrace(fumigationId);
  return NextResponse.json({ flights });
}
