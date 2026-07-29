import { PageHeader } from "@/components/page-header"
import { ParcelsTable } from "@/components/parcels/parcels-table"
import { getParcelSummaries } from "@/lib/data"

export const metadata = {
  title: "Parcelas | AFM Geovisor",
  description: "Inventario de parcelas con cadencia esperada, última fumigación y estado de cumplimiento.",
}

export const dynamic = "force-dynamic"

export default async function ParcelasPage() {
  const summaries = await getParcelSummaries()

  return (
    <>
      <PageHeader
        title="Inventario de parcelas"
        description="Cada parcela tiene su hoja de vida: cadencia esperada, historial de aplicaciones, vuelos ejecutados y trazabilidad del dato."
      />
      <div className="px-4 py-6 sm:px-6">
        <ParcelsTable summaries={summaries} />
      </div>
    </>
  )
}
