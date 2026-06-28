import Link from "next/link";

import { AppShell } from "@/components/app-shell";

/**
 * 404 amigable. Se muestra cuando una ruta no existe (App Router convention).
 * Diferencia visual con error.tsx: este es esperable (link roto), no un fallo.
 */
export default function NotFound() {
  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="404"
      subtitle="La ruta que buscás no existe o fue removida."
      title="Página no encontrada"
    >
      <div className="rounded-2xl border border-[#cfd8d3] bg-white p-8 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <p className="text-base text-[#121815]">
          Verificá la URL o volvé al panel principal.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            className="rounded-full bg-[#0b5f2d] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2c7f44]"
            href="/"
          >
            Ir al panel
          </Link>
          <Link
            className="rounded-full border border-[#cfd8d3] px-5 py-2 text-sm font-semibold text-[#0b5f2d] transition hover:bg-[#f4f7f4]"
            href="/map"
          >
            Ver mapa
          </Link>
        </div>
      </div>
    </AppShell>
  );
}