import type { ReactNode } from "react";

/**
 * ScrollablePanel — primitive para scroll interno (v1.7 sprint UI).
 *
 * Contexto: en el patron bento, cada card del grid tiene un tamaño fijo
 * (col-span + row-span). Si el contenido del card es una lista larga
 * (ej. 50 alertas, 200 items de task history), hacer scroll del body
 * rompe el layout — el operador pierde de vista los KPIs mientras
 * scrollea.
 *
 * Solucion: el contenido del card scrollea DENTRO del card. El body
 * no se mueve. Esto se logra envolviendo el contenido en un contenedor
 * con `overflow-y-auto` y un `maxHeight` (o `height` si se quiere
 * forzar el full height del card).
 *
 * Decision: NO se mete la logica del scroll en el BentoCard porque
 * no todas las cards tienen contenido largo. El caller decide
 * envolver lo que necesita.
 *
 * Tests:
 *   - `tests/components/ui/scrollable-panel.test.tsx` cubre maxHeight
 *     y className override.
 */

export interface ScrollablePanelProps {
  children: ReactNode;
  /**
   * Altura maxima del area scrollable. Default: `40vh` (40% del viewport).
   * Si queres que el panel ocupe el resto del card, pasa `maxHeight="100%"`
   * o un valor especifico en pixels/rem.
   *
   * Cualquier valor CSS valido (e.g. `"40vh"`, `"320px"`, `"100%"`).
   */
  maxHeight?: string;
  /** className adicional (opcional). */
  className?: string;
  /** ARIA label (opcional). */
  ariaLabel?: string;
  /** Rol (opcional). Default: `"region"` para que screen readers lo lean. */
  role?: "region" | "log" | "feed" | "list";
  /** data-testid (opcional). */
  testId?: string;
}

const DEFAULT_MAX_HEIGHT = "40vh";

export function ScrollablePanel({
  children,
  maxHeight = DEFAULT_MAX_HEIGHT,
  className,
  ariaLabel,
  role = "region",
  testId
}: ScrollablePanelProps) {
  const inlineStyle = { maxHeight };
  return (
    <div
      aria-label={ariaLabel}
      className={`flex flex-col overflow-y-auto ${className ?? ""}`}
      data-testid={testId}
      role={role}
      style={inlineStyle}
    >
      {children}
    </div>
  );
}
