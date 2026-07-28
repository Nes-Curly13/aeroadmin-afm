import { cn } from "@/lib/utils";

/**
 * PageHeader — header reusable para páginas internas.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/page-header.tsx`):
 *   - Eyebrow opcional (etiqueta superior pequeña, uppercase, brand color)
 *   - Título principal (text-xl/2xl font-extrabold)
 *   - Descripción opcional (text-sm text-muted-foreground)
 *   - Acciones a la derecha (botones, chips, etc.)
 *   - Metadata opcional a la derecha (e.g. "Datos al 2026-07-28 09:00")
 *
 * Accesibilidad:
 *   - El bloque de header es un `<header>` semántico.
 *   - El `title` se renderiza como `<h1>` para outline correcto.
 *   - Si se pasa `eyebrow`, NO se renderiza como heading (es solo decoración).
 *
 * Layout:
 *   - Mobile: vertical (eyebrow + title + description arriba, actions abajo)
 *   - Desktop (sm+): horizontal (texto izquierda, actions derecha)
 *
 * @example
 *   <PageHeader
 *     eyebrow="Inventario"
 *     title="Parcelas"
 *     description="Listado completo..."
 *     actions={<Button>Exportar</Button>}
 *   />
 */
export interface PageHeaderProps {
  /** Etiqueta pequeña arriba del título (e.g. "Vista agregada", "Inventario"). */
  eyebrow?: string;
  /** Título principal de la página (renderizado como h1). */
  title: string;
  /** Descripción debajo del título. Soporta texto largo. */
  description?: React.ReactNode;
  /** Acciones a la derecha del header (botones, chips, etc.). */
  actions?: React.ReactNode;
  /** Metadata opcional tipo "Datos al 2026-07-28 09:00" (alineada a la derecha). */
  meta?: React.ReactNode;
  /** Border inferior. Default: true. */
  bordered?: boolean;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  bordered = true,
  className
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 bg-card px-4 py-5 sm:px-6",
        "lg:flex-row lg:items-end lg:justify-between",
        bordered && "border-b border-border",
        className
      )}
      data-testid="page-header"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-extrabold tracking-tight text-balance sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        ) : null}
      </div>

      {(actions || meta) ? (
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          {actions}
          {meta ? (
            <p className="font-mono text-[11px] text-muted-foreground lg:ml-auto">
              {meta}
            </p>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
