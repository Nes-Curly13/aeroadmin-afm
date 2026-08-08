/**
 * GET /api/admin/parcels/[id]/report.csv
 *
 * feature/reports-level-1 (2026-08-08).
 *
 * Devuelve el reporte CSV de una parcela — para abrir en Excel-CO.
 * Misma data que el PDF (`getParcelReportData`), serializada con
 * `buildParcelReportCsv()`. Disparado desde el botón "Descargar CSV"
 * en /parcelas/[id].
 *
 * Authorization: role admin o supervisor (mismo gate que el PDF).
 *
 * Respuestas:
 *   200 + text/csv — CSV stream (Content-Disposition: attachment)
 *   401 — sin sesión
 *   403 — rol insuficiente
 *   404 — parcela no existe o soft-deleted
 *   500 — error al cargar datos
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getParcelReportData } from "@/lib/reports/fetch-parcel-report-data";
import { buildParcelReportCsv } from "@/lib/reports/parcel-csv";
import { slugFilename } from "@/lib/csv";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Sufijo YYYY-MM-DD en Bogota local. */
function todayBogotaDate(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date());
}

export async function GET(_req: Request, ctx: RouteContext) {
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

  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  let data;
  try {
    data = await getParcelReportData(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "error al cargar datos";
    // eslint-disable-next-line no-console
    console.error(`[report.csv] fetchParcelReportData(${id}) failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "parcela no existe" }, { status: 404 });
  }

  const csv = buildParcelReportCsv(data);

  const displayName = data.parcel.land_name ?? data.parcel.external_id ?? `parcela-${id}`;
  const filename = slugFilename(`reporte-${displayName}-parcela-${id}`, "csv");
  const filenameBogota = filename.replace(
    /-\d{4}-\d{2}-\d{2}\.csv$/,
    `-${todayBogotaDate()}.csv`
  );

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameBogota}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
