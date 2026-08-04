"use client"

import { LayoutDashboard, Map, Sprout, History } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/", label: "Panel", icon: LayoutDashboard },
  { href: "/geovisor", label: "Geovisor", icon: Map },
  { href: "/parcelas", label: "Parcelas", icon: Sprout },
  // Sprint 2026-08-04 — feature/parcel-onboarding. El operador
  // pidio un listado unificado de fumigaciones (en vez de tener
  // que abrir parcela por parcela). El link en la nav lo hace
  // accesible desde cualquier pagina.
  { href: "/fumigaciones", label: "Fumigaciones", icon: History },
]

export function NavLinks() {
  const pathname = usePathname()

  return (
    <nav aria-label="Navegación principal" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
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
