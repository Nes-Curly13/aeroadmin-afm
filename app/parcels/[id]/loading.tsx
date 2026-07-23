import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /parcels/[id]. Replica el chrome de la page real
 * (header de identidad + secciones de fumigación + parámetros +
 * contexto del lote). Skeleton simplificado: 4 cards de placeholder
 * + 5 filas de fumigaciones.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="parcels"
      eyebrow="Cargando parcela"
      subtitle="Obteniendo el detalle operativo de la parcela."
      title="Detalle de parcela"
    >
      <div
        aria-label="Cargando detalle de la parcela"
        className="grid gap-5 lg:grid-cols-[1.4fr_1fr]"
        role="status"
      >
        <div className="space-y-5">
          {/* Header de identidad */}
          <div className="h-28 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Card de fumigación (la más importante) */}
          <div className="h-64 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Mini mapa */}
          <div className="h-72 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Parámetros */}
          <div className="h-48 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
        </div>
        <div className="space-y-5">
          {/* Área */}
          <div className="h-40 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Plan de vuelo */}
          <div className="h-40 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Contexto del lote */}
          <div className="h-48 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
          {/* Acciones */}
          <div className="h-32 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
        </div>
      </div>
      <span className="sr-only">Cargando detalle…</span>
    </AppShell>
  );
}
