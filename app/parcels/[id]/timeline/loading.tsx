import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /parcels/[id]/timeline. Header con nombre de parcela +
 * bloque de resumen + lista de eventos placeholder, todo con animate-pulse.
 * Replica el chrome para que la transición sea coherente.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="map"
      eyebrow="Cargando parcela"
      subtitle="Obteniendo el historial de fumigaciones de la parcela."
      title="Timeline de fumigaciones"
    >
      <div
        aria-label="Cargando timeline"
        className="space-y-5"
        role="status"
      >
        <div className="h-48 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
        <div className="h-32 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              className="h-16 animate-pulse rounded-lg border border-[#eef2ee] bg-[#f4f7f4]"
              key={i}
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando timeline…</span>
    </AppShell>
  );
}
