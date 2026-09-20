"use client"

import Link from "next/link"
import { useState } from "react"
import { LogOut, Menu, UserCircle2, X } from "lucide-react"
import { fmtRelative } from "@/lib/format"
import { logoutAction } from "@/app/(public)/login/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AfmMark } from "@/components/brand/afm-mark"
import type { AppRole } from "@/lib/auth/role"
import type { DjiAgHealth } from "@/lib/types"
import { NavLinks } from "./nav-links"

/**
 * ShellLayout — chrome de la app (sidebar + header + main).
 *
 * PR-2 de la auditoría UI: **una sola arquitectura de sidebar**.
 * Antes el `<aside>` vivía inline en `app-shell.tsx` (server) sin
 * comportamiento mobile: en pantallas chicas la nav se apilaba arriba
 * y empujaba el contenido. Ahora:
 *
 *   - Desktop (lg+): sidebar fija a la izquierda (`lg:w-64`).
 *   - Mobile: sidebar oculta; se abre como **drawer off-canvas**
 *     (overlay + backdrop) desde el botón de menú del header.
 *
 * El shell mantiene el contrato de PR-1: `h-svh` + scroll encapsulado
 * en `main` (`min-h-0 flex-1 overflow-y-auto`).
 *
 * Nota de deuda técnica: el drawer no atrapa el foco (no hay focus
 * trap) ni cierra con Escape todavía — se resuelve cuando se adopte
 * el primitivo `Sheet` (PR-2b).
 */
export function ShellLayout({
  children,
  health,
  user,
  role
}: {
  children: React.ReactNode;
  health?: DjiAgHealth;
  user?: { email?: string | null };
  role?: AppRole;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const status = health?.status ?? "unknown";
  const statusColor =
    status === "ok" ? "bg-chart-1" : status === "partial" ? "bg-chart-4" : status === "unknown" ? "bg-muted-foreground/30" : "bg-destructive";

  const roleVariant: "default" | "secondary" | "outline" =
    role === "admin" ? "default" : role === "supervisor" ? "secondary" : "outline";
  const roleLabel =
    role === "admin" ? "Admin" : role === "supervisor" ? "Supervisor" : "—";

  return (
    <div className="flex h-svh flex-col overflow-hidden lg:flex-row">
      {/* Backdrop del drawer (solo mobile). */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        aria-label="Barra lateral"
        className={[
          "brand-sidebar flex shrink-0 flex-col gap-6 border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground lg:h-full lg:w-64 lg:border-b-0 lg:border-r lg:py-6",
          mobileOpen
            ? "fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r"
            : "hidden border-b lg:flex"
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            aria-label="Ir al panel principal"
            className="flex items-center gap-3"
            onClick={() => setMobileOpen(false)}
          >
            <AfmMark variant="emblem" size={40} priority />
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold tracking-tight">AFM Geovisor</span>
              <span className="text-[11px] text-sidebar-foreground/60">Topografía · Valle del Cauca</span>
            </div>
          </Link>
          <div className="flex items-center gap-1 lg:hidden">
            <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
            <span className="sr-only">{`Estado del pipeline: ${status}`}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú"
              className="size-7 p-0 text-sidebar-foreground/75 hover:bg-sidebar-accent"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div onClick={() => setMobileOpen(false)}>
          <NavLinks />
        </div>

        <div className="mt-auto flex flex-col gap-3">
          {health ? (
            <div className="hidden rounded-md border border-sidebar-border bg-sidebar-accent/60 p-3 lg:block">
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
          ) : null}

          <form action={logoutAction} className="lg:self-stretch">
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Cerrar sesión"
            >
              <LogOut className="size-3.5" aria-hidden />
              <span className="text-xs">Cerrar sesión</span>
            </Button>
          </form>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          role="banner"
          className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-6"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-8 p-0 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-4" aria-hidden />
          </Button>
          <div className="min-w-0 flex-1" aria-hidden />
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <>
                <UserCircle2 className="size-4 text-muted-foreground" aria-hidden />
                <span
                  className="hidden text-xs text-muted-foreground sm:inline"
                  title={user.email ?? undefined}
                >
                  {user.email}
                </span>
                <Badge
                  variant={roleVariant}
                  className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  aria-label={`Rol del usuario: ${roleLabel}`}
                  title={`Rol: ${roleLabel}`}
                >
                  {roleLabel}
                </Badge>
              </>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Sin sesión
              </Badge>
            )}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
