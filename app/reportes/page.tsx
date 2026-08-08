// app/reportes/page.tsx
//
// Página de reportes por hacienda / multi-hacienda (nivel 2 de
// feature/reports-level, 2026-08-08).
//
// Server component: lee los query params (from, to, farm), carga el
// data layer y renderiza el form + la última fumigación destacada +
// la tabla de parcelas + la lista de fumigaciones. Los botones de
// descarga son <a href> con los query params preservados.

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { fetchFarmsReportData } from "@/lib/reports/fetch-farms-report-data";
import { ReportsForm } from "@/components/reports/reports-form";
import { LastFumigationCard } from "@/components/reports/last-fumigation-card";
import { FarmsTable } from "@/components/reports/farms-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, History } from "lucide-react";
import Link from "next/link";
import { fmtInt, fmtDate } from "@/lib/format";

/** Helper con 2 decimales. */
function fmtDec2(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export const dynamic = "force-dynamic";

/** Devuelve el default del rango: últimos 30 días hasta hoy (Bogota). */
function defaultWindow(): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const today = fmt.format(new Date());
  const todayParts = today.split("-").map(Number);
  const dt = new Date(Date.UTC(todayParts[0]!, todayParts[1]! - 1, todayParts[2]!));
  dt.setUTCDate(dt.getUTCDate() - 30);
  const from = dt.toISOString().slice(0, 10);
  return { from, to: today };
}

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string; farm?: string }>;
}

export default async function ReportesPage({ searchParams }: ReportsPageProps) {
  const sp = await searchParams;
  const defaults = defaultWindow();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : defaults.from;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : defaults.to;
  const farm = sp.farm && sp.farm.trim() !== "" ? sp.farm.trim() : "";

  // Cargamos la data y la lista de haciendas en paralelo.
  const [data, farmOptions] = await Promise.all([
    fetchFarmsReportData({ from, to, farmName: farm || null }),
    loadFarmOptions()
  ]);

  // URLs para los botones de download (preservan los filtros).
  const queryString = new URLSearchParams({ from, to });
  if (farm) queryString.set("farm", farm);
  const pdfHref = `/api/admin/reports/farms/report.pdf?${queryString.toString()}`;
  const csvHref = `/api/admin/reports/farms/report.csv?${queryString.toString()}`;

  const isFiltered = Boolean(farm);

  return (
    <>
      <header className="border-b border-border bg-card px-4 py-5 sm:px-6">
        <Link
          href="/parcelas"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Volver al inventario
        </Link>
        <div className="mt-2">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
            Reportes de fumigación
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isFiltered
              ? `Filtrado por hacienda: ${farm}`
              : "Vista general — todas las haciendas del operador"}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        {/* Form de filtros + botones de descarga */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-primary" aria-hidden />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ReportsForm
              defaults={{ from, to, farm }}
              farmOptions={farmOptions}
              pdfHref={pdfHref}
              csvHref={csvHref}
            />
          </CardContent>
        </Card>

        {/* Stats resumen (siempre visible) */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryStat
            label="Fumigaciones"
            value={fmtInt(data.totals.nFumigations)}
          />
          <SummaryStat
            label="Área total (ha)"
            value={fmtDec2(data.totals.totalAreaHa)}
          />
          <SummaryStat
            label="Volumen total (L)"
            value={fmtDec2(data.totals.totalLiters)}
          />
          <SummaryStat
            label="Parcelas activas"
            value={fmtInt(data.totals.nParcels)}
          />
        </div>

        {/* Última fumigación destacada */}
        <LastFumigationCard last={data.lastFumigation} />

        {/* Por parcela (agregado) */}
        <FarmsTable
          parcels={data.parcels}
          totalCount={data.totals.nParcels}
          cap={50}
        />

        {/* Lista detallada de fumigaciones (cap 200) */}
        {data.fumigations.length > 0 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="size-4 text-primary" aria-hidden />
                  Fumigaciones del rango
                </CardTitle>
                <span className="font-mono text-xs text-muted-foreground">
                  {`${data.fumigations.length} de ${data.totals.nFumigations}`}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[40rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left font-semibold">Fecha</th>
                      <th className="py-2 text-left font-semibold">Parcela</th>
                      <th className="py-2 text-left font-semibold">Piloto</th>
                      <th className="py-2 text-right font-semibold">Área (ha)</th>
                      <th className="py-2 text-right font-semibold">Vol (L)</th>
                      <th className="py-2 text-left font-semibold">Producto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.fumigations.map((f) => (
                      <tr
                        key={f.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="py-2 font-mono text-xs tabular-nums">
                          {fmtDate(f.fumigation_date)}
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/parcelas/${f.parcel_id}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {f.parcel_name}
                          </Link>
                          {f.farm_name ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {f.farm_name}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {f.pilot_name ?? "—"}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {f.area_fumigated_ha === null
                            ? "—"
                            : fmtDec2(f.area_fumigated_ha)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums">
                          {f.dose_l_per_ha !== null && f.area_fumigated_ha !== null
                            ? fmtDec2(f.dose_l_per_ha * f.area_fumigated_ha)
                            : "—"}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {f.product_used ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.capReached ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Mostrando las primeras 200 fumigaciones (cap del PDF).
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/** Lista de haciendas distintas (de dji_parcels.farm_name no null). */
async function loadFarmOptions(): Promise<Array<{ name: string; count: number }>> {
  try {
    const db = getDb();
    const r = await db.query<{ name: string; count: string }>(
      `SELECT farm_name AS name, COUNT(*)::int AS count
       FROM dji_parcels
       WHERE deleted_at IS NULL AND farm_name IS NOT NULL
       GROUP BY farm_name
       ORDER BY farm_name ASC`
    );
    return r.rows
      .filter((row) => row.name !== null)
      .map((row) => ({ name: row.name, count: Number(row.count) }));
  } catch (err) {
    // No bloquear la página si la BD falla — solo el dropdown queda vacío.
    // eslint-disable-next-line no-console
    console.warn("[reportes] loadFarmOptions falló:", err);
    return [];
  }
}
