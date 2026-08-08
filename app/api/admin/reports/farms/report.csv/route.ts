/**
 * GET /api/admin/reports/farms/report.csv
 *
 * feature/reports-level-2 (2026-08-08).
 *
 * Mismo shape que el PDF pero en CSV (mismos query params).
 * Disparado desde el botón "Descargar CSV" en /reportes.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { fetchFarmsReportData } from "@/lib/reports/fetch-farms-report-data";
import { buildFarmsReportCsv } from "@/lib/reports/farms-csv";
import { slugFilename } from "@/lib/csv";

export const dynamic = "force-dynamic";

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
    console.error(`[report.farms.csv] fetchFarmsReportData failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const csv = buildFarmsReportCsv(data);

  const displayName = farmName ?? "general";
  const filename = slugFilename(`reporte-fumigaciones-${displayName}`, "csv");
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
