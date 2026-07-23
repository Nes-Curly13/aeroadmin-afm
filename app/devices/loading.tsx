import { AppShell } from "@/components/app-shell";

/**
 * Loading UI de /devices. Replica el chrome: header + grid de devices
 * (3 cards placeholder). Mismo patrón que el resto de las pages de
 * la app para que la navegación se sienta coherente.
 */
export default function Loading() {
  return (
    <AppShell
      activeSection="devices"
      eyebrow="Cargando dispositivos"
      subtitle="Obteniendo el catálogo de drones y accesorios."
      title="Dispositivos"
    >
      <div
        aria-label="Cargando dispositivos"
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-3"
        role="status"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            className="h-32 animate-pulse rounded-2xl border border-[#d2ddd6] bg-[#f4f7f4]"
            key={i}
          />
        ))}
      </div>
      <span className="sr-only">Cargando dispositivos…</span>
    </AppShell>
  );
}
