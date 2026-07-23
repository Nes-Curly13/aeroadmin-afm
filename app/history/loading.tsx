import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /history (DEPRECATED, redirige a /task-history).
 * Mismo chrome que la page real: 3 KPIs (Registros, Área, Litros) +
 * tabla de 6 filas. Mantener consistencia aunque la URL redirija.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="history"
      eyebrow="Cargando historial"
      subtitle="Obteniendo los registros históricos de fumigación."
      title="Historial DJI"
    >
      <div
        aria-label="Cargando historial"
        className="space-y-5"
        role="status"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              className="h-24 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
              key={i}
            />
          ))}
        </div>
        <div className="overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white">
          <div className="h-10 animate-pulse bg-[#f4f7f4]" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              className={`h-12 animate-pulse bg-[#f4f7f4] ${
                i === 0 ? "" : "border-t border-[#eef2ee]"
              }`}
              key={i}
            />
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando historial…</span>
    </AppShell>
  );
}
