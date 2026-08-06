import { PageHeader } from "@/components/page-header"
import { ParcelsTable } from "@/components/parcels/parcels-table"
import { getViewerRole } from "@/lib/auth/role"
import { getParcelSummaries, getParcelsWithCycle } from "@/lib/data"
import type { CyclePhase } from "@/lib/types"

export const metadata = {
  title: "Parcelas | AFM Geovisor",
  description: "Inventario de parcelas con cadencia esperada, última fumigación y estado de cumplimiento.",
}

export const dynamic = "force-dynamic"

export default async function ParcelasPage() {
  // Sprint 2026-08-01 — fetch summaries + cycle data en paralelo.
  // `getParcelsWithCycle` degrada a {null, null} si la migration
  // 20260801000000 no se aplicó (try/catch interno + warning rate-limited).
  const [summaries, parcelsWithCycle, role] = await Promise.all([
    getParcelSummaries(),
    getParcelsWithCycle(),
    // S10 (2026-08-06): el sidebar linkea a /parcelas (no a /admin/parcels),
    // asi que el admin necesita ver los botones de alta/import ACÁ. Solo
    // los admins ven los botones (los supervisores tienen read-only).
    getViewerRole()
  ])

  // Map parcel.id (string en V0) → cycle_phase para lookup O(1) en el row.
  const cycleByParcelId: Record<string, CyclePhase | null> = {}
  for (const p of parcelsWithCycle) {
    cycleByParcelId[p.id] = p.cycle_phase
  }

  return (
    <>
      <PageHeader
        title="Inventario de parcelas"
        description="Cada parcela tiene su hoja de vida: cadencia esperada, historial de aplicaciones, vuelos ejecutados y trazabilidad del dato."
      />
      <div className="px-4 py-6 sm:px-6">
        <ParcelsTable
          summaries={summaries}
          cycleByParcelId={cycleByParcelId}
          isAdmin={role === "admin"}
        />
      </div>
    </>
  )
}
