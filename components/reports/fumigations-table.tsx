// components/reports/fumigations-table.tsx
//
// Tabla detallada con TODAS las fumigaciones del rango (cap 200). Server
// component puro — recibe la lista de filas y el flag capReached.
//
// Extraída de `app/(auth)/reportes/page.tsx` en el sprint QA-14
// (2026-09-06, fix/qa-14-reportes-tabs) para que el page.tsx no
// tenga JSX inline gigante y para que esta tabla pueda reusarse desde
// otros lugares (ej. un futuro reporte por parcela individual).
//
// Decisiones:
//   - Mismo formato visual que la versión inline previa — solo se
//     mueve a un archivo. La columna Vol (L) se calcula como
//     dose_l_per_ha * area_fumigated_ha (igual que antes). Si alguno
//     de los dos es null, mostramos "—".
//   - El cap de 200 fumigaciones es el mismo que usa
//     fetchFarmsReportData (MAX_FUMIGATIONS_IN_PDF) — el page
//     muestra el banner "Mostrando las primeras 200..." cuando
//     `capReached` es true.
//   - El link a la parcela usa el `parcel_id` y el `parcel_name`.
//     Si la fila tiene `land_name` (suerte), lo agregamos como
//     texto secundario (no como link separado — la suerte no tiene
//     ruta propia).

import Link from "next/link";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import type { FarmsFumigationRow } from "@/lib/reports/fetch-farms-report-data";

/** Helper con 2 decimales para los valores numéricos del reporte. */
function fmtDec2(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function FumigationsTable({
  fumigations,
  totalCount,
  capReached
}: {
  fumigations: FarmsFumigationRow[];
  totalCount: number;
  capReached: boolean;
}) {
  if (fumigations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" aria-hidden />
            Detalle de fumigaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-muted-foreground">
            Sin fumigaciones registradas en el rango seleccionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-primary" aria-hidden />
            Detalle de fumigaciones
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {`${fumigations.length} de ${totalCount}`}
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
              {fumigations.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/60 last:border-0"
                  data-testid={`fumigation-row-${f.id}`}
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
        {capReached ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Mostrando las primeras 200 fumigaciones (cap del PDF).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
