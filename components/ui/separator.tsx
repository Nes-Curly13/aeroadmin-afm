"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@/lib/utils";

/**
 * Separator — divisor horizontal o vertical accesible.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/separator.tsx`):
 *   - Wrapper de `SeparatorPrimitive` de `@base-ui/react/separator`.
 *   - Renders un `<div>` con `role="separator"` por default.
 *   - `orientation="horizontal"` (default) → 1px de alto, full width.
 *   - `orientation="vertical"` → 1px de ancho, self-stretch (toma altura
 *     del flex parent).
 *
 * Estilos via data-attribute (`data-orientation`):
 *   - `data-horizontal:h-px data-horizontal:w-full`
 *   - `data-vertical:w-px data-vertical:self-stretch`
 *
 * Accesibilidad:
 *   - Si el separator es decorativo → el caller lo wrappea con `aria-hidden`
 *     o pasa `decorative`. Por default es semántico (separador real).
 *
 * @example
 *   <div className="flex items-center gap-3">
 *     <span>Crítico</span>
 *     <Separator orientation="vertical" className="h-4" />
 *     <span>Vencido</span>
 *   </div>
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
