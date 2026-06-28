import { AppShell } from "@/components/app-shell";

/**
 * Loading UI del segmento raíz (App Router convention).
 * Se muestra mientras Next.js hace streaming de los server components.
 * Mismo chrome que la app para que la transición sea coherente.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="Cargando"
      subtitle="Obteniendo los últimos datos de la operación."
      title="AeroAdmin AFM"
    >
      <div
        aria-label="Cargando contenido"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        role="status"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <div className="mt-5 h-64 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]" />
      <span className="sr-only">Cargando…</span>
    </AppShell>
  );
}