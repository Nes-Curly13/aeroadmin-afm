"use client"

import Link from "next/link"
import { useState } from "react"
import { LogOut, Menu, UserCircle2, X } from "lucide-react"
import { fmtRelative } from "@/lib/format"
import { logoutAction } from "@/app/(public)/login/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { AfmMark } from "@/components/brand/afm-mark"
import type { AppRole } from "@/lib/auth/role"
import type { DjiAgHealth } from "@/lib/types"
import { NavLinks } from "./nav-links"

/**
 * ShellLayout — chrome de la app (sidebar + header + main).
 *
 * PR-2 de la auditoría UI: **una sola arquitectura de sidebar**.
 *   - Desktop (lg+): sidebar fija a la izquierda (`lg:w-64`), `<aside>` estático.
 *   - Mobile: la misma barra se abre off-canvas (overlay + backdrop)
 *     desde el botón de menú del header.
 *
 * PR-2c (2026-09-21): el drawer mobile dejó de ser un `<dialog>` nativo
 * y pasó al primitivo `Sheet` (base-ui Dialog, patrón shadcn). El Sheet
 * aporta focus trap, cierre con Escape, backdrop y restauración de foco
 * al trigger sin código propio, y unifica los overlays del producto.
 *
 * El shell mantiene el contrato de PR-1: `h-svh` + scroll encapsulado
 * en `main` (`min-h-0 flex-1 overflow-y-auto`).
 */

type SidebarContentProps = {
  health?: DjiAgHealth;
  statusColor: string;
  statusLabel: string;
  onNavigate?: () => void;
};

/**
 * Contenido de la barra lateral, compartido entre el `<aside>` de
 * desktop y el `<Sheet>` de mobile. Los elementos mobile-only
 * (indicador de pipeline compacto + botón cerrar) se ocultan en desktop
 * con `lg:hidden`; el bloque de pipeline completo es `hidden lg:block`.
 */
function SidebarContent({
  health,
  statusColor,
  statusLabel,
  onNavigate
}: SidebarContentProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          aria-label="Ir al panel principal"
          className="flex items-center gap-3"
          onClick={onNavigate}
        >
          <AfmMark variant="emblem" size={40} priority />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-extrabold tracking-tight">AFM Geovisor</span>
            <span className="text-[11px] text-sidebar-foreground/60">Topografía · Valle del Cauca</span>
          </div>
        </Link>
        <div className="flex items-center gap-1 lg:hidden">
          <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
          <span className="sr-only">{`Estado del pipeline: ${statusLabel}`}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onNavigate}
            aria-label="Cerrar menú"
            className="size-7 p-0 text-sidebar-foreground/75 hover:bg-sidebar-accent"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div onClick={onNavigate}>
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
    </>
  );
}

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
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="flex h-svh flex-col overflow-hidden lg:flex-row">
        {/* Sidebar desktop (estática). En mobile se oculta y el Sheet la reemplaza. */}
        <aside
          aria-label="Barra lateral"
          className="brand-sidebar hidden h-full w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-6 text-sidebar-foreground lg:flex"
        >
          <SidebarContent
            health={health}
            statusColor={statusColor}
            statusLabel={status}
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header
            role="banner"
            className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-6"
          >
            <SheetTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0 lg:hidden"
                  aria-label="Abrir menú"
                />
              }
            >
              <Menu className="size-4" aria-hidden />
            </SheetTrigger>
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

      {/* Drawer mobile */}
      <SheetContent
        side="left"
        showCloseButton={false}
        className="brand-sidebar w-72 max-w-[85vw] gap-6 border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Menú de navegación</SheetTitle>
          <SheetDescription>Navegación principal de AeroAdmin AFM</SheetDescription>
        </SheetHeader>
        <SidebarContent
          health={health}
          statusColor={statusColor}
          statusLabel={status}
          onNavigate={() => setMobileOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
