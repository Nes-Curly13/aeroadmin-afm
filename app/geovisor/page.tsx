import type { Metadata } from "next"
import { GeovisorClient } from "@/components/geovisor/geovisor-client"
import { getGeovisorPayload } from "@/lib/data"

export const metadata: Metadata = {
  title: "Geovisor | AFM",
  description: "Mapa de parcelas de caña con filtro temporal de aplicaciones y estado de cadencia.",
}

export const dynamic = "force-dynamic"

export default async function GeovisorPage() {
  const payload = await getGeovisorPayload()
  return <GeovisorClient payload={payload} />
}
