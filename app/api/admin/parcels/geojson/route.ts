/**
 * GET /api/admin/parcels/geojson?bbox=minLng,minLat,maxLng,maxLat&excludeId=&limit=
 *
 * Devuelve las geometrías de las parcelas dentro de un bbox como
 * FeatureCollection. Se usa en el alta/re-dibujo de parcela para
 * dibujar las parcelas vecinas como contexto (evitar solapes y errores
 * de topología).
 *
 * Auth: admin | supervisor (mismo gate que el resto de /admin/parcels).
 */

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getParcelGeometriesInBbox } from "@/api/repositories";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
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
  const bboxRaw = url.searchParams.get("bbox") ?? "";
  const parts = bboxRaw.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { error: "bbox requerido con formato minLng,minLat,maxLng,maxLat" },
      { status: 400 }
    );
  }
  const [minLng, minLat, maxLng, maxLat] = parts;

  const excludeRaw = url.searchParams.get("excludeId");
  const excludeId =
    excludeRaw && /^\d+$/.test(excludeRaw) ? Number(excludeRaw) : null;
  const limitRaw = Number(url.searchParams.get("limit") ?? 500);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 500;

  try {
    const feats = await getParcelGeometriesInBbox({
      minLng,
      minLat,
      maxLng,
      maxLat,
      excludeId,
      limit
    });
    return NextResponse.json({
      type: "FeatureCollection",
      features: feats.map((f) => ({
        type: "Feature",
        id: f.id,
        properties: {
          id: f.id,
          land_name: f.land_name,
          client_name: f.client_name,
          farm_name: f.farm_name
        },
        geometry: f.geometry
      }))
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
