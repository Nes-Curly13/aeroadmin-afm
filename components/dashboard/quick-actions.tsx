import Link from "next/link";
import {
  Plus,
  Map as MapIcon,
  Sprout,
  BarChart3
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * QuickActions — accesos directos a las acciones más comunes del día a
 * día del operador fumigador.
 *
 * Fase 8 (2026-09-08): agregado al dashboard principal como parte del
 * RC (Release Candidate). El operador fumigador pidió repetidamente
 * "quiero ver los botones de acción sin tener que navegar" — antes
 * el dashboard era KPIs + chart + recent activity, sin CTA visible.
 *
 * Decisión: lo hacemos client-friendly via `<Link>` (no `Button` con
 * `onClick`) para que funcione sin JS y sea accesible por teclado /
 * screen reader sin trabajo extra. Cada acción es un bloque completo
 * (icon + label + descripción corta + URL visible) para que sea
 * descubrible sin tener que hacer hover.
 *
 * Las acciones mostradas son las 4 más usadas según feedback del
 * operador. Cualquier adición futura (e.g. "Importar Excel") debe
 * pasar por revisar el orden — la sección se vuelve ruidosa >5 items.
 */

interface QuickAction {
  href: string;
  label: string;
  description: string;
  icon: typeof Plus;
  /** Optional accent color class. Default = primary. */
  accent?: string;
}

const ACTIONS: QuickAction[] = [
  {
    href: "/fumigaciones/nueva",
    label: "Nueva fumigación",
    description: "Wizard 4 pasos: importar vuelo o registrar manual.",
    icon: Plus
  },
  {
    href: "/geovisor",
    label: "Abrir geovisor",
    description: "Mapa con parcelas y fumigaciones en el rango elegido.",
    icon: MapIcon
  },
  {
    href: "/admin/parcels/new",
    label: "Nueva parcela",
    description: "Dibujar polígono sobre el mapa satelital (admin).",
    icon: Sprout
  },
  {
    href: "/reportes",
    label: "Ver reportes",
    description: "Resumen operativo y por hacienda + exportes CSV/PDF.",
    icon: BarChart3
  }
];

export function QuickActions() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Acciones rápidas</CardTitle>
        <CardDescription>
          Lo más usado del día a día. Para administración de parcelas,
          importación y calidad de datos usá &quot;Administración&quot; en
          el sidebar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ACTIONS.map(({ href, label, description, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex items-start gap-3 rounded-md border border-input bg-card px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`${label} — ${description}`}
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-foreground group-hover:text-primary">
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
