/**
 * GET /api/health
 *
 * Auditoría 2026-09-10 (#48): `/api/health` estaba listado en `PUBLIC`
 * (lib/auth.config.ts) pero la ruta no existía. Ahora es una liveness
 * probe real, sin auth (por eso está en PUBLIC).
 *
 * Respuestas:
 *   200 { status: "ok", db: true }        — server + BD responden
 *   200 { status: "degraded", db: false } — server arriba, BD no responde
 *
 * No expone detalles del error de BD (solo un booleano) para no filtrar
 * información del schema a un endpoint público.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  try {
    const db = getDb();
    await db.query("SELECT 1 AS ok");
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json(
    {
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      ts: new Date().toISOString()
    },
    { status: 200 }
  );
}
