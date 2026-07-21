import type { ReactNode } from "react";

/**
 * BentoGrid + BentoCard — primitives para layouts bento (v1.7 sprint UI).
 *
 * Contexto: el sprint v1.7 (UI overhaul) estandariza el layout de pages
 * con el patron bento. Cada page define cards con distintos tamaños
 * (sm/md/lg/hero) y el grid las acomoda segun el espacio disponible.
 *
 * Antes (pre-v1.7) cada page renderizaba sus cards en una sola columna
 * vertical (`<div className="mt-5">...</div>`), o un grid uniforme
 * (`grid xl:grid-cols-5`). Eso llevaba a:
 *   - Todo el scroll del body mueve TODO (perdida de contexto cuando
 *     el operador scrollea para ver una alerta — pierde de vista los KPIs).
 *   - Sin jerarquia visual: todas las cards tienen el mismo peso.
 *
 * El patron bento resuelve ambos:
 *   - El grid es el "lienzo" del viewport; cada card scrollea INTERNAMENTE
 *     (con `ScrollablePanel`) si tiene muchos items.
 *   - Las cards con size="hero" o "lg" tienen peso visual mayor — el
 *     operador mira primero ahi.
 *
 * Implementacion:
 *   - CSS grid 12 cols en xl, 4 cols en lg, 2 cols en sm, 1 col en mobile.
 *   - BentoCard acepta `colSpan` y `rowSpan` por breakpoint (object) o
 *     shortcuts semanticos (`size: "sm" | "md" | "lg" | "xl" | "hero"`).
 *   - Los shortcuts cubren los 5 layouts tipicos del repo. Para layouts
 *     custom, pasar `colSpan` y `rowSpan` directamente.
 *   - Sin deps externas. Tailwind 4 + grid utilities.
 *
 * Tests:
 *   - `tests/components/ui/bento-grid.test.tsx` cubre shortcuts + custom
 *     spans + combinacion con ScrollablePanel.
 */

// ============================================================
// BentoGrid
// ============================================================

export interface BentoGridProps {
  children: ReactNode;
  /** className adicional (opcional). */
  className?: string;
  /** ARIA label para el landmark (recomendado). */
  ariaLabel?: string;
}

/**
 * Grid 12-cols en xl, 4-cols en lg, 2-cols en sm, 1-col en mobile.
 * Gap fijo 4 (16px). Si la page necesita un gap distinto, pasar `className`.
 */
export function BentoGrid({ children, className, ariaLabel }: BentoGridProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-12 ${
        className ?? ""
      }`}
    >
      {children}
    </div>
  );
}

// ============================================================
// BentoCard
// ============================================================

/**
 * Tamaños semanticos predefinidos. Cada uno mapea a un col-span + row-span
 * por breakpoint. Si necesitas un layout custom, pasar `colSpan` y `rowSpan`
 * directamente (los shortcuts se ignoran en ese caso).
 *
 * Convencion:
 *   - sm:   3/12 cols, 1 row.  Para KPIs compactos.
 *   - md:   6/12 cols, 1 row.  Para listas chicas (alertas, upcoming).
 *   - lg:   8/12 cols, 1 row.  Para listas grandes (operations).
 *   - xl:  12/12 cols, 1 row.  Para cards full-width (totals, summary).
 *   - hero: 12/12 cols, 2 rows. Para el "main" del dashboard, mapa, etc.
 *
 * En mobile (1 col) y sm (2 cols) y lg (4 cols), los sizes se
 * distribuyen razonablemente (sm=2, md=2, lg=4, xl/xl+col-span-X)
 * para que el grid no rompa en pantallas chicas.
 */
export type BentoSize = "sm" | "md" | "lg" | "xl" | "hero";

const SIZE_CLASS: Record<BentoSize, string> = {
  sm: "col-span-1 sm:col-span-1 lg:col-span-2 xl:col-span-3",
  md: "col-span-1 sm:col-span-2 lg:col-span-4 xl:col-span-6",
  lg: "col-span-1 sm:col-span-2 lg:col-span-4 xl:col-span-8",
  xl: "col-span-1 sm:col-span-2 lg:col-span-4 xl:col-span-12",
  hero: "col-span-1 sm:col-span-2 lg:col-span-4 xl:col-span-12 xl:row-span-2"
};

/**
 * Tipos para spans custom. Por breakpoint opcional. Si solo se pasa xl,
 * los demas breakpoint heredan el default de la grid (1 col en mobile,
 * 2 en sm, 4 en lg). Si se pasa `colSpan` como numero, se aplica a xl
 * (modo "tengo una sola configuracion para desktop").
 */
export interface BentoSpans {
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export interface BentoCardProps {
  children: ReactNode;
  /** Shortcut semantico. Si se pasa, ignora `colSpan` y `rowSpan`. */
  size?: BentoSize;
  /** Col-span custom por breakpoint. Default: heredar del size. */
  colSpan?: number | BentoSpans;
  /** Row-span custom por breakpoint. Default: 1. */
  rowSpan?: number | BentoSpans;
  /** className adicional (opcional). */
  className?: string;
  /** data-testid (opcional). */
  testId?: string;
  /** Rol semantico (opcional). Por defecto no se setea. */
  role?: "region" | "article" | "complementary";
  /** ARIA label (opcional, recomendado si el card no tiene heading visible). */
  ariaLabel?: string;
}

/**
 * Card bento. Estilos compartidos: rounded-2xl, border, bg-white,
 * shadow consistente con `ELEVATION.card` de `lib/ui-tokens.ts`.
 *
 * Si el card tiene contenido que puede exceder el alto disponible
 * (ej. una lista de 50 alertas), envolver los children en un
 * `<ScrollablePanel>`. Asi el card mantiene su tamaño del grid
 * y solo el contenido interno scrollea.
 */
export function BentoCard({
  children,
  size,
  colSpan,
  rowSpan,
  className,
  testId,
  role,
  ariaLabel
}: BentoCardProps) {
  // Shortcut semantico tiene prioridad sobre custom spans.
  const colSpanClass = size
    ? SIZE_CLASS[size]
    : colSpan
      ? spanToClass(colSpan, "col")
      : "col-span-1";
  const rowSpanClass = rowSpan ? spanToClass(rowSpan, "row") : "";
  return (
    <div
      aria-label={ariaLabel}
      className={`flex flex-col rounded-2xl border border-[#d2ddd6] bg-white p-5 shadow-[0px_18px_40px_rgba(15,23,42,0.08)] ${colSpanClass} ${rowSpanClass} ${
        className ?? ""
      }`}
      data-testid={testId}
      data-bento-size={size}
      role={role}
    >
      {children}
    </div>
  );
}

/**
 * Convierte un span (numero o BentoSpans) a clases Tailwind. Helper
 * interno — exportado solo para tests.
 *
 * Si el input es un numero, se aplica a xl (modo "tengo una sola config
 * para desktop"). En breakpoints mas chicos hereda el default del grid
 * (1 col en mobile, 2 en sm, 4 en lg).
 *
 * Si el input es un BentoSpans (object), se respeta cada breakpoint.
 */
export function spanToClass(span: number | BentoSpans, kind: "col" | "row"): string {
  const prefix = kind === "col" ? "col-span" : "row-span";
  if (typeof span === "number") {
    return `${prefix}-${span}`;
  }
  // Si no se pasa xl pero si otros, el xl no setea (default 12 en grid, queda full).
  // Si no se pasa un breakpoint, no generamos clase (default del grid).
  const parts: string[] = [];
  if (span.sm !== undefined) parts.push(`sm:${prefix}-${span.sm}`);
  if (span.md !== undefined) parts.push(`md:${prefix}-${span.md}`);
  if (span.lg !== undefined) parts.push(`lg:${prefix}-${span.lg}`);
  if (span.xl !== undefined) parts.push(`xl:${prefix}-${span.xl}`);
  return parts.join(" ");
}
