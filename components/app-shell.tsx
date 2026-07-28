import Image from "next/image"
import { fmtRelative } from "@/lib/format"
import type { DjiAgHealth } from "@/lib/types"
import { NavLinks } from "./nav-links"

/**
 * AppShell — sidebar + main wrapper.
 *
 * v2.3 (S8 — V0 rebuild): recibe `health` por prop en vez de llamar
 * `getHealth()` adentro. Razón: si este componente importa `getHealth`
 * desde `@/lib/data` (server-only), Turbopack arrastra `lib/djiag-health`
 * (con `node:fs/promises`) al bundle del cliente cuando el children es
 * un Client Component → "the chunking context (unknown) does not support
 * external modules".
 *
 * El layout server (app/layout.tsx) llama `getHealth()` y lo pasa como
 * prop. Así AppShell queda libre de imports Node-only y los Client
 * Components (geovisor-client, parcels-table) pueden vivir como hijos
 * sin arrastrar nada.
 */
export function AppShell({
  children,
  health
}: {
  children: React.ReactNode;
  health: DjiAgHealth;
}) {
  const statusColor =
    health.status === "ok" ? "bg-chart-1" : health.status === "partial" ? "bg-chart-4" : "bg-destructive"

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground lg:sticky lg:top-0 lg:h-svh lg:w-64 lg:border-b-0 lg:border-r lg:py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-md bg-white">
              <Image src="/afm-logo.svg" alt="Logo AFM" width={40} height={40} className="size-10 object-contain" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold tracking-tight">AFM Geovisor</span>
              <span className="text-[11px] text-sidebar-foreground/60">Fumigación de caña · Valle</span>
            </div>
          </div>
          <div className="lg:hidden">
            <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
            <span className="sr-only">{`Estado del pipeline: ${health.status}`}</span>
          </div>
        </div>

        <NavLinks />

        <div className="mt-auto hidden rounded-md border border-sidebar-border bg-sidebar-accent/60 p-3 lg:block">
          <div className="flex items-center gap-2">
            <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/70">
              Pipeline DJI AG
            </span>
          </div>
          <p className="mt-2 font-mono text-xs text-sidebar-foreground/80">
            Último run {fmtRelative(health.last_run_at)}
          </p>
          <p className="font-mono text-xs text-sidebar-foreground/60">
            {health.parcels_synced} parcelas · {health.flights_synced} vuelos
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
