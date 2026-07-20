import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /map. Mismo chrome que la página real para que la transición
 * sea coherente: 5 cards KPI arriba (con pulse) + un placeholder del mapa +
 * una fila inferior con dos paneles. Evita el flash blanco al navegar.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="map"
      eyebrow="Vista espacial"
      subtitle="Cargando el mapa operativo de parcelas DJI."
      title="Mapa de Parcelas"
    >
      <div
        aria-label="Cargando mapa"
        className="mb-4 grid gap-4 md:grid-cols-5"
        role="status"
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            className="h-48 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <div className="h-[480px] animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
      <span className="sr-only">Cargando mapa…</span>
    </AppShell>
  );
}
