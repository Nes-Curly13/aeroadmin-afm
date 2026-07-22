// components/dashboard/dashboard-empty-state.tsx
//
// Sprint A — F3.0: banner de "Aún no hay datos" para instalaciones nuevas.
//
// Por qué existe:
//   Antes (pre-F3.0) un supervisor que abría el dashboard con la BD recién
//   poblada (o vacía) veía 5 KPIs en 0 + "Sin alertas" + "Sin fumigaciones"
//   + "Reporte 2026" con N/A. No sabía que tenía que importar datos
//   primero. Este banner es la respuesta a "¿por qué todo está en cero?".
//
// Cuándo se muestra:
//   - metrics.totalFlights === 0 (no hay vuelos)
//   - overdueCount === 0 (no hay cadencias vencidas)
//   - highAlerts.length === 0 (no hay alertas HIGH)
//   Equivale a "no hay data operativa de fumigación todavía". Si CUALQUIERA
//   de las 3 tiene data, el banner NO se muestra — los KPIs y cards valen
//   más que el banner.
//
// No usa el componente <EmptyState> de components/ui porque este banner
// necesita un layout custom (icono grande + headline + body + CTA inline)
// más prominente que el EmptyState estándar.

import Link from "next/link";

export interface DashboardEmptyStateProps {
  /**
   * URL del doc de operaciones al que apunta el CTA. Default
   * `/docs/ARCHITECTURE.md` (doc raíz de operaciones). En runtime
   * el path absoluto se construye desde el public root del repo.
   */
  docsHref?: string;
}

function DatabaseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-12 w-12"
      fill="none"
      height="48"
      viewBox="0 0 24 24"
      width="48"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function DashboardEmptyState({
  docsHref = "/docs/ARCHITECTURE.md"
}: DashboardEmptyStateProps) {
  return (
    <div
      className="rounded-2xl border-2 border-dashed border-[#cfd8d3] bg-gradient-to-br from-white to-[#f4f7f4] p-10 text-center shadow-[0px_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="dashboard-empty-state"
    >
      <div className="flex justify-center text-[#587064]">
        <DatabaseIcon />
      </div>
      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#587064]">
        Instalación nueva
      </p>
      <h2 className="mt-2 text-2xl font-black text-[#121815] sm:text-3xl">
        Aún no hay datos de fumigación
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-[#4a5b50]">
        Para empezar, ejecutá el scraper DJI AG en el server. Esto sincroniza las fincas, los
        vuelos y las fumigaciones desde DJI SmartFarm.
      </p>
      <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-4">
        <Link
          className="inline-flex items-center gap-2 rounded-full bg-[#0b5f2d] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0a4f25]"
          data-testid="dashboard-empty-state-cta-docs"
          href={docsHref}
          rel="noopener"
          target="_blank"
        >
          Ver guía de operaciones
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="text-xs text-[#7a8c80]">
          El supervisor o el dev pueden correr el scraper desde el server.
        </p>
      </div>
    </div>
  );
}
