/**
 * GET /api/admin/parcels/[id]/report.pdf
 *
 * feature/reports-level-1 (2026-08-08).
 *
 * Devuelve el reporte PDF de una parcela — el mismo que produce
 * `buildParcelReportHtml()` + `renderHtmlToPdf()`. Disparado desde el
 * botón "Descargar PDF" en /parcelas/[id].
 *
 * Authorization: role admin o supervisor. El reporte es read-only y
 * el supervisor fumigador también lo necesita para auditoría ICA. Si en
 * el futuro se quiere admin-only, cambiar a `requireRole("admin")`.
 *
 * Respuestas:
 *   200 + application/pdf — PDF stream (Content-Disposition: attachment)
 *   401 — sin sesión
 *   403 — rol insuficiente
 *   404 — parcela no existe o soft-deleted
 *   500 — error al renderizar
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { getParcelReportData } from "@/lib/reports/fetch-parcel-report-data";
import { buildParcelReportHtml } from "@/lib/reports/parcel-pdf-template";
import { renderHtmlToPdf } from "@/lib/reports/render-pdf";
import { slugFilename } from "@/lib/csv";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Sufijo YYYY-MM-DD en Bogota local. Usado para el filename. */
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
    console.error(`[report.pdf] fetchParcelReportData(${id}) failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "parcela no existe" }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    const html = buildParcelReportHtml(data);
    pdf = await renderHtmlToPdf(html);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[report.pdf] renderHtmlToPdf(${id}) failed:`, err);
    return NextResponse.json(
      { error: "error al renderizar PDF" },
      { status: 500 }
    );
  }

  const displayName = data.parcel.land_name ?? data.parcel.external_id ?? `parcela-${id}`;
  const filename = slugFilename(`reporte-${displayName}-parcela-${id}`, "pdf");
  // Reemplazamos el sufijo de fecha que slugFilename agrega porque queremos
  // la fecha Bogota (no la del server) y el id de la parcela en el nombre.
  const filenameBogota = filename.replace(
    /-\d{4}-\d{2}-\d{2}\.pdf$/,
    `-${todayBogotaDate()}.pdf`
  );

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filenameBogota}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store"
    }
  });
}
