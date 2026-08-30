/**
 * GET /api/admin/reports/flights/export.csv
 *
 * Feature TBD (2026-08-30) — export CSV de todos los vuelos.
 *
 * Disparado desde el botón "Descargar CSV de vuelos" en /reportes
 * (o desde una futura sección de analytics). Mismo patrón que
 * /api/admin/reports/farms/report.csv: auth admin/supervisor,
 * Content-Disposition attachment, BOM UTF-8, separador `;`.
 *
 * Query params:
 *   - from=YYYY-MM-DD (obligatorio)
 *   - to=YYYY-MM-DD   (obligatorio)
 *   - drone_id=<n>    (opcional, drone_model_code)
 *   - pilot=<str>     (opcional, ILIKE substring)
 *   - parcel_id=<n>   (opcional, FK a dji_parcels)
 *   - include_orphans=true|false  (default true)
 *   - include_default_team=true|false  (default true)
 *
 * Cap: 50.000 filas (≈ 7x estado actual, 8.7k). Si llega al cap, el
 * CSV lo notifica en la sección Cabecera.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/role";
import { slugFilename } from "@/lib/csv";
import { buildFlightsReportCsv } from "@/lib/reports/flights-csv";
import { fetchFlightsReportData } from "@/lib/reports/fetch-flights-report-data";

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
  // 1) Auth: admin o supervisor (datos operacionales sensibles).
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

  // 2) Validar query params.
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const droneIdRaw = url.searchParams.get("drone_id");
  const pilot = url.searchParams.get("pilot");
  const parcelIdRaw = url.searchParams.get("parcel_id");
  const includeOrphans = url.searchParams.get("include_orphans") !== "false";
  const includeDefaultTeam = url.searchParams.get("include_default_team") !== "false";

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
  const droneId = droneIdRaw != null && droneIdRaw !== "" ? Number(droneIdRaw) : null;
  if (droneIdRaw != null && (Number.isNaN(droneId) || droneId! < 0)) {
    return NextResponse.json(
      { error: "drone_id debe ser numérico" },
      { status: 400 }
    );
  }
  const parcelId = parcelIdRaw != null && parcelIdRaw !== "" ? Number(parcelIdRaw) : null;
  if (parcelIdRaw != null && (Number.isNaN(parcelId) || parcelId! < 0)) {
    return NextResponse.json(
      { error: "parcel_id debe ser numérico" },
      { status: 400 }
    );
  }

  // 3) Fetch + serialize.
  let data;
  try {
    data = await fetchFlightsReportData({
      from,
      to,
      droneId,
      pilot: pilot && pilot.length > 0 ? pilot : null,
      parcelId,
      includeOrphans,
      includeDefaultTeam
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "error al cargar datos";
    // eslint-disable-next-line no-console
    console.error(`[report.flights.csv] fetchFlightsReportData failed:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const csv = buildFlightsReportCsv(data);

  const filename = slugFilename(`aeroadmin-flights-${from}-${to}`, "csv");
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
