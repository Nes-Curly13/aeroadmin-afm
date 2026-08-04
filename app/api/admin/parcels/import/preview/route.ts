/**
 * POST /api/admin/parcels/import/preview — parsea un archivo GIS subido
 * (KML / SHP-zip / GPKG) y devuelve la preview de features para que el
 * operador confirme antes de crear las parcelas.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding, sub-sprint 2 (Import GIS).
 *
 * Auth: admin only (la mutación es destructiva — crea N parcelas).
 * Body: multipart/form-data con campo `file` (el .kml/.zip/.gpkg).
 * Response 200: { features, warnings, format }
 * Response 400: { error } (formato no soportado, archivo inválido, etc)
 *
 * Decisión: NO soportamos KMZ (KML zipeado) en MVP. Si lo suben, tira
 * "formato no soportado" con mensaje claro. Agregar KMZ es trivial
 * (unzip + pasar el doc.kml adentro al parser KML), pero no era
 * un caso de uso del operador.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { parseGisFile } from "@/lib/gis-import";
import { approxAreaM2 } from "@/lib/gis-import/normalize";

export const runtime = "nodejs"; // Necesitamos Node.js APIs (Buffer, fs)
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Auth: admin only
  try {
    await requireRole("admin");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "no autenticado" }, { status: 401 });
    }
    if (e.code === "FORBIDDEN") {
      return NextResponse.json({ error: "rol insuficiente" }, { status: 403 });
    }
    return NextResponse.json(
      { error: e.message ?? "auth error" },
      { status: 500 }
    );
  }

  // Parse multipart
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: `Body inválido (multipart esperado): ${err instanceof Error ? err.message : "?"}` },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Falta el archivo (campo 'file' en multipart)" },
      { status: 400 }
    );
  }

  // Validar nombre
  if (!file.name || file.name.length === 0) {
    return NextResponse.json({ error: "Archivo sin nombre" }, { status: 400 });
  }

  // Convertir a Buffer
  const buffer = Buffer.from(await file.arrayBuffer());

  // Parsear
  let result;
  try {
    result = await parseGisFile(buffer, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error desconocido al parsear" },
      { status: 400 }
    );
  }

  // Enriquecer con área estimada (m² → ha con 2 decimales).
  // El cálculo real lo hace PostGIS al hacer el INSERT (ST_Area), pero
  // para la preview al operador le sirve ver "este polígono mide ~12 ha".
  const enriched = {
    ...result,
    features: result.features.map((f, idx) => ({
      index: idx,
      name: f.name,
      properties: f.properties,
      geometry: f.geometry,
      approxAreaHa:
        Math.round((approxAreaM2(f.geometry) / 10_000) * 100) / 100
    }))
  };

  return NextResponse.json(enriched);
}
