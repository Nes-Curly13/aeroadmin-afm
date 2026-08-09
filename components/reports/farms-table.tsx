// components/reports/farms-table.tsx
//
// Tabla con el agregado por parcela del reporte. Server component puro.
//
// feature/reports-level-2 (2026-08-08).

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtInt, fmtDec, fmtDate } from "@/lib/format";
import type { FarmsParcelAgg } from "@/lib/reports/fetch-farms-report-data";

/** Helper con 2 decimales — para los valores que no son enteros. */
function fmtDec2(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function FarmsTable({
  parcels,
  totalCount,
  cap
}: {
  parcels: FarmsParcelAgg[];
  totalCount: number;
  cap: number;
}) {
  if (parcels.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por parcela</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-sm text-muted-foreground">
            Sin parcelas con fumigaciones en el rango.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Por parcela</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {`${parcels.length} de ${totalCount}`}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 text-left font-semibold">Parcela</th>
              <th className="py-2 text-left font-semibold">Hacienda</th>
              <th className="py-2 text-right font-semibold">#</th>
              <th className="py-2 text-right font-semibold">Área (ha)</th>
              <th className="py-2 text-right font-semibold">Litros (L)</th>
              <th className="py-2 text-left font-semibold">Última</th>
            </tr>
          </thead>
          <tbody>
            {parcels.map((p) => (
              <tr
                key={p.parcel_id}
                className="border-b border-border/60 last:border-0 hover:bg-muted/30"
              >
                <td className="py-2.5">
                  <Link
                    href={`/parcelas/${p.parcel_id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {p.parcel_name}
                  </Link>
                </td>
                <td className="py-2.5 text-muted-foreground">
                  {p.farm_name ?? "—"}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums">
                  {fmtInt(p.n_fumigations)}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums">
                  {fmtDec2(p.total_area_ha)}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums">
                  {fmtDec2(p.total_liters)}
                </td>
                <td className="py-2.5 font-mono text-xs tabular-nums text-muted-foreground">
                  {p.last_fumigation_date ? fmtDate(p.last_fumigation_date) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalCount > cap ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Mostrando las primeras {cap} parcelas (de {totalCount} totales).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
