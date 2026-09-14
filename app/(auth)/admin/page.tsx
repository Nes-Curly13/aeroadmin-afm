import Link from "next/link";
import {
  Activity,
  CalendarClock,
  Database,
  FileSpreadsheet,
  ListChecks,
  MapPlus,
  Sparkles
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * /admin — landing de administración.
 *
 * Fase 8 (2026-09-08): creado como destino del link "Administración" en
 * el sidebar (NavLinks). Hasta ahora no existía — los sub-links de admin
 * (`/admin/parcels`, `/admin/calidad`, `/admin/applications`,
 * `/admin/parcels/import`) solo eran accesibles vía URL directa o
 * desde el banner de calidad de datos.
 *
 * Esta página es server-rendered, no fetchea data (es un índice puro).
 * El role gate es el mismo que el resto de `/admin/*` — el `proxy.ts`
 * (NextAuth) filtra por role=admin.
 *
 * Decisión: NO incluir "Volver al panel" porque la nav ya tiene
 * "Inicio" → `/`. El operador fumigador con role viewer no llega acá
 * (filtro del proxy), así que el contenido es seguro para mostrar
 * directamente a admin.
 */

interface AdminLink {
  href: string;
  title: string;
  description: string;
  icon: typeof Database;
}

const ADMIN_LINKS: AdminLink[] = [
  {
    href: "/admin/parcels",
    title: "Parcelas (admin)",
    description: "Inventario extendido con todas las parcelas (incluyendo soft-deleted) y edición de metadata (cliente, finca, área declarada).",
    icon: MapPlus
  },
  {
    href: "/admin/parcels/new",
    title: "Nueva parcela",
    description: "Alta manual de parcela con dibujo de polígono sobre mapa satelital.",
    icon: Sparkles
  },
  {
    href: "/admin/parcels/import",
    title: "Importar parcelas",
    description: "Importador CSV / GeoJSON para sembrar parcelas en bulk.",
    icon: FileSpreadsheet
  },
  {
    // UI-12: descripcion suavizada ("5 patrones de data quality" -> "problemas
    // de calidad de datos"). El operador fumigador no es dev; "data quality"
    // sin contexto no le dice nada.
    href: "/admin/calidad",
    title: "Calidad de datos",
    description: "Problemas de calidad de datos en el dataset (parcelas sin cliente, sin finca, sin ciclo activo, fumigaciones en ciclo cerrado, etc.).",
    icon: ListChecks
  },
  {
    // UI-12: descripcion suavizada ("source='import_excel'" -> "del Excel").
    href: "/admin/applications",
    title: "Aplicaciones importadas",
    description: "Lista de fumigaciones importadas del Excel del operador fumigador.",
    icon: Database
  },
  {
    href: "/admin/reglas-fitosanitarias",
    title: "Reglas fitosanitarias",
    description: "Aplicaciones recomendadas por fase del cultivo. Ajustá ventanas y cadencias; la planificación se recalcula automáticamente.",
    icon: CalendarClock
  },
  {
    href: "/admin/pipeline",
    title: "Salud del pipeline DJI",
    description: "Estado del scraper DJI AG y últimos lotes importados. Monitoreo técnico.",
    icon: Activity
  }
];

export const dynamic = "force-dynamic";

export default function AdminLandingPage() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Administración"
        description="Herramientas internas para mantener la base de datos limpia y actualizada. Acceso restringido al rol admin."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {ADMIN_LINKS.map(({ href, title, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-label={`Ir a ${title}`}
          >
            <Card className="h-full transition-colors group-hover:border-primary/40 group-hover:bg-primary/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="size-4 text-primary" aria-hidden />
                  {title}
                </CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              {/* UI-12: removido el <p>{href}</p> (mostraba el path crudo
                  del link, ruido para el operador fumigador que no es dev).
                  El href sigue en el <Link href={href}> (accesible por
                  teclado y screen reader). Si hace falta ver la URL,
                  hover sobre la card o inspeccionar elemento. */}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
