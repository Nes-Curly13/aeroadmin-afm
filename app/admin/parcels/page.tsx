import { AppShell } from "@/components/app-shell";
import { ParcelsTable, type ParcelSummary } from "@/components/parcels/parcels-table";
import {
  getAllFumigationSchedules,
  getParcelsNormalized
} from "@/api/repositories";
import { getViewerRole } from "@/lib/auth/role";
import { getFumigationStatus } from "@/lib/fumigation-cadence";

/**
 * /admin/parcels — vista administrativa de parcelas (sprint S7.2).
 *
 * Diferencia con `/parcels`:
 *   - `/parcels` usa el `<ParcelsList>` (lista operativa, búsqueda y
 *     paginación client-side, ideal para "encontrar una parcela rápido").
 *   - `/admin/parcels` usa el `<ParcelsTable>` del V0 (vista tabla con
 *     sort por cualquier columna, chips de cadencia, ideal para "revisar
 *     el portafolio entero y filtrar por cadencia").
 *
 * Decisiones:
 *   - Server component (mismo patrón que `/parcels`).
 *   - Trae 1000 parcels (límite actual del dataset ~1207). Si crece,
 *     migrar a paginación server-side con searchParams.
 *   - Usa `getAllFumigationSchedules()` (batch query agregado en S7.2)
 *     para derivar la cadencia per-parcela sin N+1 queries.
 *   - `activeSection="parcels"` para que el sidebar marque este item.
 *     El link del sidebar apunta a `/parcels` (vista operativa); este
 *     page es una alternativa administrativa accesible vía URL directa.
 *   - Sin role gate (S7.3: gate admin-only cuando se habilite la UI de
 *     edición de `client_name`/`farm_name`).
 */
export const dynamic = "force-dynamic";

const PARCELS_LIMIT = 1000;

export default async function AdminParcelsPage() {
  const [parcelsResult, schedules] = await Promise.all([
    getParcelsNormalized(1, PARCELS_LIMIT),
    getAllFumigationSchedules()
  ]);

  // v2.1 — derivar `ParcelSummary[]` server-side. Mismo shape que el
  // v0 espera: { parcel, schedule, status, daysUntilNextDue, eventsCount, flightsCount }.
  // eventsCount/flightsCount se quedan en 0 (la ParcelsTable los usa
  // como "—" si no se pasan). El S7.3 los agregará con queries batch.
  const summaries: ParcelSummary[] = parcelsResult.data.map((parcel) => {
    const schedule = schedules.get(parcel.id) ?? null;
    const cadence = schedule?.recommended_cadence_days ?? 14;
    const status = getFumigationStatus(
      parcel.last_fumigation_date,
      cadence
    );
    return {
      parcel,
      schedule,
      status,
      daysUntilNextDue: parcel.days_since_last_fumigation != null
        ? cadence - parcel.days_since_last_fumigation
        : null,
      eventsCount: 0,
      flightsCount: 0
    };
  });

  // v1.5: sidebar gate.
  const viewerRole = await getViewerRole();

  return (
    <AppShell
      activeSection="parcels"
      eyebrow="Vista administrativa"
      parcelsCount={parcelsResult.data.length}
      subtitle={`Portafolio completo (${summaries.length} parcelas) con cadencia esperada, última fumigación y estado de cumplimiento. Vista alternativa a /parcels (operativa) con sort/filter estilo V0.`}
      title="Parcelas (admin)"
      viewerRole={viewerRole}
    >
      <ParcelsTable summaries={summaries} />
    </AppShell>
  );
}
