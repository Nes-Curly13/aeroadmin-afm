import type { Metadata } from "next"
import { Suspense } from "react"
import { GeovisorClient } from "@/components/geovisor/geovisor-client"
import { PageHeader } from "@/components/page-header"
import { PageSpinner } from "@/components/ui/loading"
import { getGeovisorPayload } from "@/lib/data"

export const metadata: Metadata = {
  title: "AFM Geovisor",
  // QA-02 (2026-09-06): simplificación del propósito del geovisor.
  // La utilidad principal es "consultar el histórico de fumigaciones
  // realizadas sobre las parcelas" — sin cadencia ni estado.
  description:
    "Mapa de parcelas con histórico de fumigaciones aplicadas. Filtrá por fecha y consultá el detalle de cada aplicación."
}

export const dynamic = "force-dynamic"

export default function GeovisorPage() {
  // S10 (2026-08-06): Suspense boundary. El <PageSpinner> se muestra
  // mientras se carga getGeovisorPayload() (parcels + fumigations +
  // hulls + cache composicion — ~500ms cold, ~50ms warm). El mapa
  // se monta completo de una vez porque necesita TODA la data para
  // renderizar pins/poligonos.
  // UI-10: <PageHeader> afuera del Suspense (no depende de data) ->
  // aparece instantaneamente en lugar de esperar al payload.
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Geovisor"
        description="Mapa de parcelas con histórico de fumigaciones aplicadas. Filtrá por fecha y consultá el detalle de cada aplicación."
      />
      <Suspense fallback={<PageSpinner message="Cargando mapa de parcelas y aplicaciones..." />}>
        <GeovisorContent />
      </Suspense>
    </div>
  )
}

async function GeovisorContent() {
  const payload = await getGeovisorPayload()
  return (
    <div className="min-h-0 flex-1">
      <GeovisorClient payload={payload} />
    </div>
  )
}
