import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /parcels. Replica el chrome de la page real (header
 * "Parcelas") + bloque de búsqueda + tabla con 6 filas de placeholder.
 * Mismo patrón que `app/parcels/overdue/loading.tsx` pero simplificado
 * porque el listado de parcelas es más plano (no hay summary chips).
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="parcels"
      eyebrow="Cargando listado"
      subtitle="Obteniendo las parcelas importadas desde DJI Agras."
      title="Parcelas"
    >
      <div
        aria-label="Cargando listado de parcelas"
        className="space-y-4"
        role="status"
      >
        {/* Skeleton del bloque búsqueda + contador */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-9 w-72 animate-pulse rounded-lg border border-[#d2ddd6] bg-[#f4f7f4]" />
          <div className="h-5 w-32 animate-pulse rounded bg-[#f4f7f4]" />
        </div>
        {/* Skeleton de la tabla */}
        <div className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white">
          <div className="h-10 animate-pulse bg-[#f4f7f4]" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              className={`h-14 animate-pulse bg-[#f4f7f4] ${
                i === 0 ? "" : "border-t border-[#eef2ee]"
              }`}
              key={i}
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando listado…</span>
    </AppShell>
  );
}
