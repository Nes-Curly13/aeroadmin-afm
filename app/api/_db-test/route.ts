// TEMPORAL: endpoint de diagnóstico para DNS + DB.
// Devuelve el resultado de dns.lookup del host de Supabase + un SELECT 1
// contra la DB. Lo borramos después de confirmar que la app funciona.
import dns from "node:dns";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const host = "db.daqvmldoyzoymlrmruyl.supabase.co";
  const out: Record<string, unknown> = { ts: new Date().toISOString() };

  // 1. DNS lookup
  try {
    const addrs = await dns.promises.lookup(host, { all: true });
    out.dns = { ok: true, addrs };
  } catch (e) {
    out.dns = { ok: false, error: (e as Error).message, code: (e as { code?: string }).code };
  }

  // 2. Default order
  out.defaultOrder = (dns as { getDefaultResultOrder?: () => string }).getDefaultResultOrder?.() ?? "n/a";

  // 3. SELECT 1 contra la DB
  try {
    const db = getDb();
    const r = await db.query("SELECT 1 as ok, version() as v");
    out.db = { ok: true, row: r.rows[0] };
  } catch (e) {
    out.db = { ok: false, error: (e as Error).message, code: (e as { code?: string }).code };
  }

  return NextResponse.json(out);
}
