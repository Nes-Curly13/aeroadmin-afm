/**
 * GET /api/admin/parcels/search
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding. Endpoint liviano
 * para alimentar el combobox de "seleccionar parcela" del wizard
 * `NewFumigationDialog` (en /fumigaciones).
 *
 * Devuelve una lista acotada de parcelas que matchean `q` (búsqueda
 * case-insensitive en land_name, external_id, client_name, farm_name,
 * municipality). Devuelve solo los campos que el combobox necesita
 * (id, land_name, external_id, client_name, farm_name, municipality,
 * source) — no la fila completa con todas las geometrías.
 *
 * Query params:
 *   - `q` (string, opcional, mínimo 1 char para evitar query vacía)
 *   - `limit` (number, opcional, default 10, max 50)
 *
 * Auth: `requireRole(["admin", "supervisor"])` — admin y supervisor
 * pueden ver parcelas. La escritura está en otros endpoints.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

interface ParcelSearchRow {
  id: number;
  land_name: string | null;
  external_id: string;
  source: string;
  client_name: string | null;
  farm_name: string | null;
  municipality: string | null;
}

export async function GET(req: Request) {
  try {
    // `AppRole` solo incluye admin y supervisor. Cualquiera de los
    // dos puede ver parcelas (mismo gate que /admin/parcels). Si
    // en el futuro agregamos "viewer" al type, lo agregamos aca.
    await requireRole(["admin", "supervisor"]);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json({ error: e.message ?? "auth error" }, { status: 500 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));

  // Si no hay query, devolvemos lista vacía. Forzamos al combobox
  // a que el usuario escriba al menos 1 char antes de buscar.
  if (q.length < 1) {
    return NextResponse.json({ parcels: [] });
  }

  const like = `%${q}%`;
  const db = getDb();
  try {
    const result = await db.query<ParcelSearchRow>(
      `SELECT
          p.id,
          p.land_name,
          p.external_id,
          p.source,
          p.client_name,
          p.farm_name,
          p.municipality
         FROM dji_parcels p
        WHERE p.deleted_at IS NULL
          AND (
            p.land_name ILIKE $1
            OR p.external_id ILIKE $1
            OR COALESCE(p.client_name, '') ILIKE $1
            OR COALESCE(p.farm_name, '') ILIKE $1
            OR COALESCE(p.municipality, '') ILIKE $1
            OR CAST(p.id AS text) = $2
          )
        ORDER BY
          CASE WHEN p.land_name ILIKE $1 THEN 0 ELSE 1 END,
          p.land_name NULLS LAST
        LIMIT $3`,
      [like, q, limit]
    );
    return NextResponse.json({ parcels: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
