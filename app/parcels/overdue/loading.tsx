import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /parcels/overdue. Header + 4 chips de resumen + 6-8 filas
 * de la lista, todo con animate-pulse. Replica el chrome de la página real
 * para que la transición sea coherente.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="map"
      eyebrow="Planificación"
      subtitle="Cargando parcelas que necesitan fumigación según cadencia."
      title="Faltan por fumigar"
    >
      <div
        aria-label="Cargando listado de parcelas"
        className="grid gap-3 md:grid-cols-4"
        role="status"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            className="h-20 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <div className="mt-5 overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white">
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            className={`h-20 animate-pulse bg-[#f4f7f4] ${
              i === 0 ? "" : "border-t border-[#eef2ee]"
            }`}
            key={i}
          />
        ))}
      </div>
      <span className="sr-only">Cargando listado…</span>
    </AppShell>
  );
}
