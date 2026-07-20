// app/parcels/overdue/page.tsx
//
// M3-M5 Q2 — Vista "Faltan por fumigar" (overdue parcels).
// Server component que carga los datos y delega la UI interactiva
// (filtros) al client component `OverdueList`.
//
// User story:
//   "Como supervisor/owner, abro /parcels/overdue y veo las
//   parcelas que necesitan fumigación esta semana, ordenadas
//   por urgencia, con filtros por cultivo y orchard."
//
// Filtros via URL searchParams (mismo patrón que /task-history):
//   - ?severity=overdue|due_soon|ok|no_history (opcional, default: todos)
//   - ?cropType=Maíz|Caña|... (opcional)
//   - ?isOrchard=true|false (opcional)
//   - ?maxDaysAhead=N (opcional, default 14)

import { AppShell } from "@/components/app-shell";
import { OverdueList } from "@/components/overdue/overdue-list";
import { getOverdueParcels } from "@/api/repositories";
import type { OverdueParcel } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function getSingleParam(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseSeverityFilter(
  value: string | undefined
): "overdue" | "due_soon" | "ok" | "no_history" | undefined {
  if (!value) return undefined;
  if (value === "overdue" || value === "due_soon" || value === "ok" || value === "no_history") {
    return value;
  }
  return undefined;
}

function parseMaxDaysAhead(value: string | undefined): number {
  if (!value) return 14;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 14;
  return Math.min(Math.floor(n), 90);
}

function parseIsOrchard(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export default async function OverduePage({ searchParams }: PageProps) {
  const severityFilter = parseSeverityFilter(getSingleParam(searchParams.severity));
  const cropType = getSingleParam(searchParams.cropType);
  const isOrchard = parseIsOrchard(getSingleParam(searchParams.isOrchard));
  const maxDaysAhead = parseMaxDaysAhead(getSingleParam(searchParams.maxDaysAhead));

  const allParcels: OverdueParcel[] = await getOverdueParcels({
    maxDaysAhead,
    cropType,
    isOrchard
  });

  // Filtro de severidad client-side (es 1 valor, no necesita ir al server)
  const parcels = severityFilter
    ? allParcels.filter((p) => p.severity === severityFilter)
    : allParcels;

  // Resumen: counts por severidad (sobre el set completo, no filtrado)
  const summary = {
    total: allParcels.length,
    overdue: allParcels.filter((p) => p.severity === "overdue").length,
    due_soon: allParcels.filter((p) => p.severity === "due_soon").length,
    ok: allParcels.filter((p) => p.severity === "ok").length,
    no_history: allParcels.filter((p) => p.severity === "no_history").length,
    max_days_ahead: maxDaysAhead
  };

  // Total hectares fumigables del set (para contexto)
  const totalHa = allParcels.reduce(
    (sum, p) => sum + (p.area_fumigable_ha ?? 0),
    0
  );

  return (
    <AppShell
      actions={
        <div className="rounded-full border border-[#cfd8d3] bg-white px-4 py-2 text-sm font-semibold text-[#4a5b50]">
          Ventana: {maxDaysAhead} días
        </div>
      }
      activeSection="faltan"
      eyebrow="Planificación"
      parcelsCount={allParcels.length}
      subtitle="Parcelas que necesitan fumigación según cadencia. Ordenadas por urgencia: vencidas primero, luego las que vencen esta semana. Click en una fila para abrir el detalle."
      title="Faltan por fumigar"
    >
      <OverdueList
        parcels={parcels}
        summary={summary}
        totalHa={Math.round(totalHa * 100) / 100}
      />
    </AppShell>
  );
}
