import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtDateTime, fmtDec, fmtLiters, SOURCE_LABEL } from "@/lib/format"
import type { DjiFumigation, DjiParcel } from "@/lib/types"

// UI-01: cap del dashboard a las 8 mas recientes. El page pasa mas
// fumigaciones para KPIs/cadencia; este panel solo muestra las ultimas
// para que la Card no se vuelva infinita.
const RECENT_LIMIT = 8

export function RecentActivity({
  fumigations,
  parcelById,
}: {
  fumigations: DjiFumigation[]
  parcelById: Map<string, DjiParcel>
}) {
  // UI-01: slice antes del render + flag para el empty state.
  const visible = fumigations.slice(0, RECENT_LIMIT)
  const hasMore = fumigations.length > RECENT_LIMIT

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>Últimas aplicaciones registradas</CardTitle>
            <CardDescription>Trazabilidad por parcela, origen del dato y volumen aplicado</CardDescription>
          </div>
          {/* UI-01: link "Ver todas" cuando hay mas fumigaciones que las
              que mostramos aca. Apunta al listado completo. */}
          {hasMore && (
            <Link
              href="/fumigaciones"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              aria-label="Ver todas las fumigaciones"
            >
              Ver todas <ArrowRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {visible.length === 0 ? (
          // UI-01: empty state cuando el dataset esta vacio (operador
          // nuevo, sin fumigaciones registradas).
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            Sin aplicaciones registradas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Área</TableHead>
                  <TableHead className="text-right">Volumen</TableHead>
                  <TableHead className="text-right">Vuelos</TableHead>
                  <TableHead>Origen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((f) => {
                const parcel = parcelById.get(f.parcel_id)
                return (
                  <TableRow key={f.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDateTime(f.executed_at)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/parcelas/${f.parcel_id}`} className="font-semibold hover:text-primary hover:underline">
                        {parcel?.name ?? f.parcel_id}
                      </Link>
                      <span className="block text-[11px] text-muted-foreground">{parcel?.farm_name}</span>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-xs">{f.product}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right font-mono text-xs">
                      {`${fmtDec(f.area_treated_ha)} ha`}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right font-mono text-xs">
                      {fmtLiters(f.volume_l)}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono text-xs">{f.flights_count}</TableCell>
                    <TableCell>
                      <Badge variant={f.source === "manual" ? "outline" : "secondary"} className="font-mono text-[10px]">
                        {SOURCE_LABEL[f.source]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
