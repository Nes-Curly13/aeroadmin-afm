/**
 * GET /api/admin/fumigations/[id]/report.pdf
 *
 * Genera un PDF con el detalle de UNA fumigación. Reusa:
 *   - `lib/reports/fumigation-pdf-template.ts` (template HTML)
 *   - `lib/reports/render-pdf.ts` (Playwright → PDF)
 *   - `lib/reports/fumigation-csv.ts` shape (FumigationReportData)
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
 *
 * Auth: admin o supervisor.
 *
 * NO incluye imagen satelital (reuso de infra de parcel report sería
 * scope creep). El operador ve el mapa en /fumigacion/[id]. Si en el
 * futuro se quiere, se agrega reusando `render-map-screenshot.ts`.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  getFumigationById,
  getFumigationFlights,
  getParcelById
} from "@/api/repositories";
import { droneModel } from "@/lib/data";
import { renderHtmlToPdf } from "@/lib/reports/render-pdf";
import { buildFumigationPdfHtml } from "@/lib/reports/fumigation-pdf-template";
import type { FumigationReportData } from "@/lib/reports/fumigation-csv";
import { FUMIGATION_CATEGORIES } from "@/lib/data-constants";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Auth
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

  // Id
  const { id } = await params;
  const fumigationId = Number(id);
  if (!Number.isFinite(fumigationId) || fumigationId <= 0) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  // Cargar data
  const fumigation = await getFumigationById(fumigationId);
  if (!fumigation) {
    return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
  }
  const [parcelData, flights] = await Promise.all([
    getParcelById(fumigation.parcel_id),
    getFumigationFlights(fumigation.flight_ids)
  ]);

  // Resolver dron + categoría
  const drone =
    fumigation.drone_code_used != null &&
    [0, 72, 201, 210].includes(fumigation.drone_code_used)
      ? (() => {
          const d = droneModel(fumigation.drone_code_used as 0 | 72 | 201 | 210);
          return d.id === 0 ? null : { code: d.id, name: d.name, tank_l: d.tank_l };
        })()
      : null;
  const category =
    fumigation.category ??
    (fumigation.category_id != null
      ? FUMIGATION_CATEGORIES.find((c) => c.id === fumigation.category_id) ?? null
      : null);

  const data: FumigationReportData = {
    fumigation,
    parcel: parcelData
      ? {
          id: parcelData.id,
          land_name: parcelData.land_name,
          external_id: parcelData.external_id
        }
      : null,
    drone,
    category: category
      ? { id: category.id, slug: category.slug, label: category.label, color: category.color }
      : null,
    flights
  };

  const html = buildFumigationPdfHtml(data);
  const pdf = await renderHtmlToPdf(html);
  const filename = `fumigacion-${fumigationId}.pdf`;

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store"
    }
  });
}
