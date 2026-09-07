import type { Metadata } from "next"
import { Suspense } from "react"
import { GeovisorClient } from "@/components/geovisor/geovisor-client"
import { PageSpinner } from "@/components/ui/loading"
import { getGeovisorPayload } from "@/lib/data"

export const metadata: Metadata = {
  title: "Geovisor | AFM",
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
  return (
    <Suspense fallback={<PageSpinner message="Cargando mapa de parcelas y aplicaciones..." />}>
      <GeovisorContent />
    </Suspense>
  )
}

async function GeovisorContent() {
  const payload = await getGeovisorPayload()
  return <GeovisorClient payload={payload} />
}
