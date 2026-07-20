import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /task-history. Header card con totales + 3-4 day cards con
 * el mismo shape que la página real (Figma frame B), todo con animate-pulse.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="task-history"
      eyebrow="Trazabilidad DJI"
      subtitle="Cargando el rollup diario de fumigaciones."
      title="Historial de tareas"
    >
      <div
        aria-label="Cargando historial de tareas"
        className="grid gap-4 md:grid-cols-2"
        role="status"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            className="h-44 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <span className="sr-only">Cargando historial…</span>
    </AppShell>
  );
}
