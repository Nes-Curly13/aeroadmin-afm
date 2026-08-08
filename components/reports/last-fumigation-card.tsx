// components/reports/last-fumigation-card.tsx
//
// Card destacada con la última fumigación del rango. Server component
// puro (recibe props).
//
// feature/reports-level-2 (2026-08-08).

import Link from "next/link";
import { Calendar, MapPin, Plane, Sprout, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FarmsLastFumigation } from "@/lib/reports/fetch-farms-report-data";

/** Helper con 2 decimales — para los valores que no son enteros. */
function fmtDec2(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function LastFumigationCard({
  last
}: {
  last: FarmsLastFumigation | null;
}) {
  if (!last) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4 text-primary" aria-hidden />
            Última fumigación del rango
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin fumigaciones registradas en el rango seleccionado.
          </p>
        </CardContent>
      </Card>
    );
  }

  const area =
    last.area_fumigated_ha === null
      ? "—"
      : `${fmtDec2(last.area_fumigated_ha)} ha`;
  const volume =
    last.dose_l_per_ha !== null && last.area_fumigated_ha !== null
      ? `${fmtDec2(last.dose_l_per_ha * last.area_fumigated_ha)} L`
      : "—";

  const fields: Array<{
    icon: typeof Calendar;
    label: string;
    value: string;
  }> = [
    { icon: Calendar, label: "Fecha", value: last.fumigation_date },
    { icon: MapPin, label: "Hacienda", value: last.farm_name ?? "—" },
    { icon: Sprout, label: "Parcela", value: last.parcel_name },
    { icon: User, label: "Piloto", value: last.pilot_name ?? "—" },
    { icon: Plane, label: "Dron", value: last.drone_nickname ?? "—" },
    { icon: Sprout, label: "Producto", value: last.product_used ?? "—" }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="size-4 text-primary" aria-hidden />
            Última fumigación del rango
          </CardTitle>
          <Link
            href={`/parcelas/${last.parcel_id}`}
            className="text-xs font-medium text-primary hover:underline"
          >
            Ver parcela →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <f.icon className="size-3" aria-hidden />
                {f.label}
              </dt>
              <dd className="mt-0.5 font-medium text-foreground">{f.value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Área fumigada
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{area}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Volumen aplicado
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{volume}</dd>
          </div>
        </dl>
        {last.farm_name ? (
          <div className="mt-3">
            <Badge variant="outline">{last.farm_name}</Badge>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
