/**
 * GET /api/admin/fumigations/[id]/report.csv
 *
 * Genera un CSV con el detalle de UNA fumigación. Reusa el serializer
 * de `lib/reports/fumigation-csv.ts`.
 *
 * Sprint 2026-08-13 — feature/fumigacion-detail-v2 / sub-4.
 *
 * Auth: admin o supervisor. Mismo gate que el resto de fumigaciones
 * (los reportes de fumigaciones son data operacional sensible).
 *
 * Cache: NO se cachea. Cada download refleja el estado actual de la
 * fumigación (importante para auditoría). El cliente puede re-fetch
 * si sospecha data desactualizada.
 *
 * Respuestas:
 *   200 + text/csv — CSV con BOM, filename en Content-Disposition
 *   401 / 403 — auth
 *   404 + JSON — fumigación no existe
 *   500 — error interno
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import {
  getFumigationById,
  getFumigationFlights,
  getParcelById,
  getParcelsByExternalIds
} from "@/api/repositories";
import { droneModel } from "@/lib/data";
import { buildFumigationCsv, type FumigationReportData } from "@/lib/reports/fumigation-csv";
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

  // Cargar data (con try/catch para devolver JSON 500 consistente en
  // vez de que Next.js devuelva un HTML 500. Consistente con el resto
  // de los endpoints del repo. Fix sprint 2026-08-13 sub-4.)
  let fumigation: Awaited<ReturnType<typeof getFumigationById>>;
  let parcelData: Awaited<ReturnType<typeof getParcelById>>;
  let flights: Awaited<ReturnType<typeof getFumigationFlights>>;
  let secondaryParcels: Awaited<ReturnType<typeof getParcelsByExternalIds>> = [];
  try {
    fumigation = await getFumigationById(fumigationId);
    if (!fumigation) {
      return NextResponse.json({ error: "fumigación no encontrada" }, { status: 404 });
    }
    // Parcel + flights + suertes secundarias en paralelo.
    // Sprint S9 — feature/multi-parcela-fumigation: hidrata secondaryParcels
    // si la fumigación cubrió más de 1 suerte (parcels[] poblado).
    [parcelData, flights, secondaryParcels] = await Promise.all([
      getParcelById(fumigation.parcel_id),
      getFumigationFlights(fumigation.flight_ids),
      fumigation.parcels && fumigation.parcels.length > 0
        ? getParcelsByExternalIds(fumigation.parcels)
        : Promise.resolve([])
    ]);
  } catch (err) {
    const e = err as { message?: string };
    return NextResponse.json(
      { error: `error cargando fumigación: ${e.message ?? "unknown"}` },
      { status: 500 }
    );
  }

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
    flights,
    secondaryParcels: secondaryParcels.map((p) => ({
      id: p.id,
      external_id: p.external_id,
      land_name: p.land_name,
      field_type: p.field_type
    }))
  };

  const csv = buildFumigationCsv(data);
  const filename = `fumigacion-${fumigationId}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
