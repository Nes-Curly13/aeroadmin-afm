import Image from "next/image"
import Link from "next/link"
import { LogOut, UserCircle2 } from "lucide-react"
import { fmtRelative } from "@/lib/format"
import { logoutAction } from "@/app/login/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { auth } from "@/lib/auth"
import type { AppRole } from "@/lib/auth/role"
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
 * v2.3.2 (S8.2 — leak fix): `health` ahora es OPCIONAL. El layout NO
 * llama `getHealth()` en cada request (causaba leak de ~3MB/req que
 * tumbaba el dev server en ~30 reqs). Si el caller (e.g. un page
 * server que sí necesita health) lo pasa por prop, se muestra el
 * badge; si no, el sidebar oculta el indicador de pipeline.
 *
 * Para el dashboard `/admin/djiag-health` (donde el health ES el
 * contenido de la pagina), el page server debe llamar `getHealth()`
 * y pasarlo a `<AppShell health={h}>`.
 *
 * v2.7.1 (Sprint 2026-08-02 — QA): agregamos botón de logout al pie
 * de la sidebar. Antes no había forma de salir del panel — el
 * operador quedaba logueado para siempre. Usa un form con
 * `logoutAction` (server action) para que el POST no requiera JS
 * del cliente (mejor accesibilidad + no rompe si el bundle del
 * cliente tiene un error).
 *
 * v2.8 (Sprint 2026-08-04 — UX): agregamos top header con email + role
 * del usuario actual. El operador fumigador pidió "ver qué tipo de
 * usuario soy" en cada página — antes el role solo aparecía en el
 * middleware logs. El badge es un `Badge` de base-ui con variant
 * distinto por role (admin = default/primary, supervisor = secondary,
 * viewer = outline) para que sea visualmente distinguible de un
 * vistazo. `await auth()` lee del JWT (no pega a la BD), no es un
 * issue de performance.
 */
export async function AppShell({
  children,
  health
}: {
  children: React.ReactNode;
  health?: DjiAgHealth;
}) {
  const status = health?.status ?? "unknown";
  const statusColor =
    status === "ok" ? "bg-chart-1" : status === "partial" ? "bg-chart-4" : status === "unknown" ? "bg-muted-foreground/30" : "bg-destructive";

  // Sesión actual (lee del JWT firmado, no query a la BD).
  // El middleware ya filtra /admin/* por role, así que si llegamos
  // acá siempre hay sesión — pero el `?` es defensa.
  const session = await auth();
  const user = session?.user;
  const role: AppRole | undefined = user?.role;

  // Variant del badge según role. "admin" usa default (primary color),
  // "supervisor" usa secondary, viewer y unknowns usan outline.
  // Sin esto el operador no distingue visualmente a simple vista.
  const roleVariant: "default" | "secondary" | "outline" =
    role === "admin" ? "default" : role === "supervisor" ? "secondary" : "outline";
  const roleLabel =
    role === "admin" ? "Admin" : role === "supervisor" ? "Supervisor" : role === "viewer" ? "Viewer" : "—";

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-6 border-b border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground lg:sticky lg:top-0 lg:h-svh lg:w-64 lg:border-b-0 lg:border-r lg:py-6">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/dashboard"
            aria-label="Ir al panel principal"
            className="flex items-center gap-3"
          >
            {/* S8.8 (v2.7.1): el SVG es vertical (485x695). Para que se vea
                completo en el sidebar horizontal, usamos object-contain
                con un contenedor mas alto que ancho (h-12 w-auto, ratio 0.7).
                La palabra "AFM Geovisor" + subtitulo van a la derecha. */}
            <div className="flex h-12 w-[34px] items-center justify-center overflow-hidden rounded-md bg-white">
              <Image
                src="/afm-logo.svg"
                alt="Logo AFM"
                width={485}
                height={695}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold tracking-tight">AFM Geovisor</span>
              <span className="text-[11px] text-sidebar-foreground/60">Fumigación de caña · Valle</span>
            </div>
          </Link>
          <div className="lg:hidden">
            <span className={`inline-block size-2 rounded-full ${statusColor}`} aria-hidden />
            <span className="sr-only">{`Estado del pipeline: ${status}`}</span>
          </div>
        </div>

        <NavLinks />

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

          {/* Logout button (QA gap cerrado 2026-08-02). El form con
              server action funciona sin JS del cliente — accesible
              desde keyboard, screen reader, y si el bundle falla
              no rompe el flow de logout. El button size='sm' + ghost
              variant + fullWidth en mobile (sidebar top bar) para
              que sea visible sin importar el breakpoint. */}
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

      <main className="min-w-0 flex-1">
        {/* Top header (v2.8 — sprint 2026-08-04). Identifica al usuario
            actual en TODAS las páginas: email + role badge. Sticky en
            top con `backdrop-blur` para que se vea bien cuando el
            contenido scrollea. El role del badge tiene variant distinto
            (default/secondary/outline) segun el rol — admin se ve
            "relleno" (primary), supervisor "atenuado" (secondary),
            viewer "contorno" (outline). Asi el operador distingue
            visualmente sin leer texto. */}
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card/90 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/70 sm:px-6"
          role="banner"
        >
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
        {children}
      </main>
    </div>
  )
}
