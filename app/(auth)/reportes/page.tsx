// app/reportes/page.tsx
//
// Página de reportes por hacienda / multi-hacienda (nivel 2 de
// feature/reports-level, 2026-08-08).
//
// QA-14 (2026-09-06, fix/qa-14-reportes-tabs): el operador pidio
// "mejorar la logica y la usabilidad" porque la pagina apilaba
// 4-5 secciones sin diferenciacion clara. Refactor:
//
//   1. Bloque "Que hace esta pagina" arriba — explica que hace
//      cada tab y los botones PDF/CSV.
//   2. KPIs siempre visibles arriba de las tabs (no cambian con
//      la tab activa).
//   3. 3 tabs (Resumen / Por hacienda / Detalle) en vez de
//      secciones apiladas. Cada tab muestra solo lo relevante
//      para su nivel de detalle.
//   4. Tabla detallada extraida a `FumigationsTable` (server
//      component puro).
//
// Server component: lee los query params (from, to, farm), carga el
// data layer y renderiza. Los botones de descarga son <a href> con
// los query params preservados.

import { redirect } from "next/navigation";
import { getDistinctFarmsWithCounts } from "@/api/repositories";
import { fetchFarmsReportData } from "@/lib/reports/fetch-farms-report-data";
import { defaultWindow, quickRange } from "@/lib/reports/date-range";
import { ReportsForm } from "@/components/reports/reports-form";
import { LastFumigationCard } from "@/components/reports/last-fumigation-card";
import { FarmsTable } from "@/components/reports/farms-table";
import { FumigationsTable } from "@/components/reports/fumigations-table";
import { ReportsTabs } from "@/components/reports/reports-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, Info } from "lucide-react";
import Link from "next/link";
import { fmtInt } from "@/lib/format";

/** Helper con 2 decimales. */
function fmtDec2(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export const dynamic = "force-dynamic";

interface ReportsPageProps {
  searchParams: Promise<{ from?: string; to?: string; farm?: string }>;
}

export default async function ReportesPage({ searchParams }: ReportsPageProps) {
  const sp = await searchParams;
  // "Hoy" en Bogota — fuente de verdad para los presets.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  const todayParts = todayStr.split("-").map(Number);
  const defaults = defaultWindow(todayParts);
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : defaults.from;
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : defaults.to;
  const farm = sp.farm && sp.farm.trim() !== "" ? sp.farm.trim() : "";

  // Sprint S9.2 — rangos rápidos precomputados. Cada uno genera
  // una URL que el form pasa al botón "Período". Mismos todayParts
  // que defaultWindow para que los presets sean consistentes.
  const presets = {
    "7d": quickRange(todayParts, "7d"),
    "30d": quickRange(todayParts, "30d"),
    "90d": quickRange(todayParts, "90d"),
    month: quickRange(todayParts, "month"),
    year: quickRange(todayParts, "year")
  };

  // Cargamos la data y la lista de haciendas en paralelo.
  const [data, farmOptions] = await Promise.all([
    fetchFarmsReportData({ from, to, farmName: farm || null }),
    getDistinctFarmsWithCounts()
  ]);

  // URLs para los botones de download (preservan los filtros).
  const queryString = new URLSearchParams({ from, to });
  if (farm) queryString.set("farm", farm);
  const pdfHref = `/api/admin/reports/farms/report.pdf?${queryString.toString()}`;
  const csvHref = `/api/admin/reports/farms/report.csv?${queryString.toString()}`;

  // URLs para los presets de rango rápido. Preservan el filtro
  // `farm` si está activo (ej. "últimos 7d en El Limar").
  const presetUrl = (preset: { from: string; to: string }): string => {
    const params = new URLSearchParams({ from: preset.from, to: preset.to });
    if (farm) params.set("farm", farm);
    return `/reportes?${params.toString()}`;
  };

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
        {/* QA-14: bloque introductorio "Que hace esta pagina". Antes
            la pagina apilaba 5 secciones sin explicacion y el
            operador decia "no entiendo que hace". Ahora hay un
            bloque claro arriba con bullets cortos que resumen que
            muestra cada tab y para que sirven los exports. */}
        <Card data-testid="reports-intro">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="size-4 text-primary" aria-hidden />
              ¿Qué hace esta página?
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Resumen</strong> — KPIs del período
                (fumigaciones, área, volumen, parcelas) + la última
                fumigación destacada. Vista rápida para entender
                qué se fumigó.
              </li>
              <li>
                <strong>Por hacienda</strong> — Agregado por parcela
                (cuántas fumigaciones, área total, última fecha).
                Útil para comparar el rendimiento entre haciendas
                o detectar las más activas.
              </li>
              <li>
                <strong>Detalle</strong> — Cada fumigación del
                rango individual (cap 200). Click en la parcela
                para abrir su hoja de vida completa.
              </li>
              <li>
                <strong>Descargar PDF / CSV</strong> — Los botones
                exportan el reporte completo con los mismos
                filtros que tenés en pantalla. El CSV es
                compatible con Excel-es (separador{" "}
                <code className="rounded bg-muted px-1 text-[11px]">;</code>).
              </li>
            </ul>
          </CardContent>
        </Card>

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
              presets={{
                "7d": presetUrl(presets["7d"]),
                "30d": presetUrl(presets["30d"]),
                "90d": presetUrl(presets["90d"]),
                month: presetUrl(presets.month),
                year: presetUrl(presets.year),
                defaultWindow: presetUrl(defaults)
              }}
            />
          </CardContent>
        </Card>

        {/* Stats resumen (siempre visible, pase la tab que pase) */}
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

        {/* QA-14: tabs que organizan las 3 vistas. El state vive en
            el client component ReportsTabs (no en URL). Si en el
            futuro se quiere deep-link, migrar a searchParams. */}
        <ReportsTabs
          resumen={<LastFumigationCard last={data.lastFumigation} />}
          parcelas={
            <FarmsTable
              parcels={data.parcels}
              totalCount={data.totals.nParcels}
              cap={50}
            />
          }
          detalle={
            <FumigationsTable
              fumigations={data.fumigations}
              totalCount={data.totals.nFumigations}
              capReached={data.capReached}
            />
          }
        />
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
