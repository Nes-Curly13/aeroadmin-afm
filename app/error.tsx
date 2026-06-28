"use client";

import { useEffect } from "react";

import { AppShell } from "@/components/app-shell";

/**
 * Error boundary del segmento raíz.
 * Captura errores no manejados de server components, route handlers, o client components
 * debajo del AppShell. El usuario ve el chrome de la app + un mensaje claro, no la pantalla
 * blanca genérica de Next.js.
 *
 * Reset() reintenta el segmento — útil cuando el error fue transitorio (timeout de DB, etc.).
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log estructurado al servidor (en producción queremos Sentry/equivalent; por ahora consola)
    console.error("[app/error.tsx]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack
    });
  }, [error]);

  return (
    <AppShell
      activeSection="dashboard"
      eyebrow="Error"
      subtitle="Algo falló al cargar esta vista. El equipo técnico ya fue notificado."
      title="No pudimos completar la operación"
    >
      <div className="rounded-2xl border border-[#a93232] bg-white p-6 shadow-[0px_18px_40px_rgba(15,23,42,0.08)]">
        <p className="text-base text-[#121815]">
          Ocurrió un error inesperado. Podés intentar de nuevo, o volver al panel principal.
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-[#587064]">
            ID de seguimiento: <code className="rounded bg-[#f4f7f4] px-1.5 py-0.5">{error.digest}</code>
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="rounded-full bg-[#0b5f2d] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2c7f44]"
            onClick={reset}
            type="button"
          >
            Reintentar
          </button>
          <a
            className="rounded-full border border-[#cfd8d3] px-5 py-2 text-sm font-semibold text-[#0b5f2d] transition hover:bg-[#f4f7f4]"
            href="/"
          >
            Ir al panel
          </a>
        </div>
      </div>
    </AppShell>
  );
}