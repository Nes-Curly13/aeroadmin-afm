"use client"

import {
  LayoutDashboard,
  Map,
  Sprout,
  History,
  BarChart3,
  Settings
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

/**
 * NavLinks — links principales de la sidebar.
 *
 * Fase 8 (2026-09-08): reordenado a la spec del operador fumigador.
 * Antes el orden era `Panel / Geovisor / Parcelas / Fumigaciones /
 * Reportes` (el orden histórico del mockup V0). Ahora es
 * `Inicio / Parcelas / Fumigaciones / Geovisor / Reportes /
 * Administración` — el recurso "Parcelas" (lo más usado del día a día)
 * queda segundo, después del dashboard. "Administración" es un link
 * nuevo al landing `/admin` que se creó en este mismo PR.
 *
 * "Inicio" reemplaza el label "Panel" para alinearse con la
 * terminología de la spec del producto (el operador no usa la palabra
 * "panel" en su vocabulario). La URL sigue siendo `/`.
 */
const LINKS = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/parcelas", label: "Parcelas", icon: Sprout },
  { href: "/fumigaciones", label: "Fumigaciones", icon: History },
  { href: "/geovisor", label: "Geovisor", icon: Map },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/admin", label: "Administración", icon: Settings }
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegación principal" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {LINKS.map(({ href, label, icon: Icon }) => {
        // Active match:
        //   - "/" matchea solo la home exacta
        //   - "/admin" matchea "/admin", "/admin/parcels", "/admin/calidad", etc.
        //   - resto matchea prefijo
        const active =
          href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
