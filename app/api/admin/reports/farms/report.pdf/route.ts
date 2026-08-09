/**
 * GET /api/admin/reports/farms/report.pdf
 *
 * feature/reports-level-2 (2026-08-08).
 *
 * Devuelve el reporte PDF de fumigaciones por hacienda o multi-hacienda
 * según los query params:
 *   - from: YYYY-MM-DD (requerido)
 *   - to: YYYY-MM-DD (requerido)
 *   - farm: nombre de la hacienda (opcional; si no, vista general)
 *
 * Disparado desde la página /reportes (botón "Descargar PDF").
 *
 * Authorization: role admin o supervisor (mismo gate que el reporte
 * de parcela).
 *
 * Respuestas:
 *   200 + application/pdf — PDF stream
 *   400 — params inválidos
 *   401/403 — auth
 *   500 — error de render
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { fetchFarmsReportData } from "@/lib/reports/fetch-farms-report-data";
import { buildFarmsReportHtml } from "@/lib/reports/farms-pdf-template";
import { renderHtmlToPdf } from "@/lib/reports/render-pdf";
import { slugFilename } from "@/lib/csv";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function todayBogotaDate(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(new Date());
}

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

  // Validar query params.
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const farmName = url.searchParams.get("farm");

  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json(
      { error: "param 'from' requerido (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "param 'to' requerido (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  let data;
  try {
    data = await fetchFarmsReportData({ from, to, farmName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error al cargar datos";
    // eslint-disable-next-line no-console
    console.error(`[report.farms.pdf] fetchFarmsReportData failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let pdf: Buffer;
  try {
    const html = buildFarmsReportHtml(data);
    pdf = await renderHtmlToPdf(html);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[report.farms.pdf] renderHtmlToPdf failed:`, err);
    return NextResponse.json(
      { error: "error al renderizar PDF" },
      { status: 500 }
    );
  }

  const displayName = farmName ?? "general";
  const filename = slugFilename(`reporte-fumigaciones-${displayName}`, "pdf");
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
