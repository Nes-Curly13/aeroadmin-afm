import Link from "next/link"
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

export function RecentActivity({
  fumigations,
  parcelById,
}: {
  fumigations: DjiFumigation[]
  parcelById: Map<string, DjiParcel>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimas aplicaciones registradas</CardTitle>
        <CardDescription>dji_fumigations · trazabilidad por parcela, origen del dato y volumen aplicado</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
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
              {fumigations.map((f) => {
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
      </CardContent>
    </Card>
  )
}
