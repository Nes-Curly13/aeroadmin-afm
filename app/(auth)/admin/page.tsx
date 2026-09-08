import Link from "next/link";
import {
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
    href: "/admin/calidad",
    title: "Calidad de datos",
    description: "5 patrones de data quality (parcela sin cliente, sin finca, sin ciclo activo, fumigación en ciclo cerrado, parcela stale).",
    icon: ListChecks
  },
  {
    href: "/admin/applications",
    title: "Aplicaciones importadas",
    description: "Lista de fumigaciones importadas del Excel del operador fumigador (source='import_excel').",
    icon: Database
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
              <CardContent>
                <p className="font-mono text-xs text-muted-foreground group-hover:text-foreground">
                  {href}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
