"use client"

/**
 * components/ui/loading.tsx
 *
 * Loading primitives — Skeletons, Spinners, PageSpinner.
 *
 * Sprint S10 (2026-08-06): creados para mejorar la perceived performance
 * de pages con data pesada (1213 parcelas en /parcelas + /geovisor, etc).
 *
 * Decisiones de diseño:
 *   - Sin dep nueva. CSS keyframes inline en globals.css. Mas liviano
 *     que framer-motion y empata con el diseno AFM (verde primario, fondo
 *     --background, paleta --muted).
 *   - Skeletons con `animate-pulse` (Tailwind default) sobre bg-muted.
 *     Patron shadcn estandar.
 *   - Spinner: anillo con `border-t-transparent` rotando. Color --primary.
 *   - PageSpinner: logo AFM + spinner central + mensaje opcional.
 *   - Todo "use client" porque usa CSS animations y props dinamicas.
 *     Skeletons en server components (dentro de Suspense) funcionan
 *     perfectamente — el boundary client boundary es Suspense.
 *
 * Uso:
 *   - <Spinner />              en botones durante submit
 *   - <Skeleton className="h-4 w-32" />  en lineas de texto
 *   - <SkeletonTable rows={5} cols={6} />  en tablas
 *   - <PageSpinner message="Cargando parcelas..." />  full-page
 */

import { Loader2 } from "lucide-react"
import type { HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

// ============================================================
// Spinner — anillo rotando, color primary.
// ============================================================

interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  /** Tamano en pixeles. Default 16. */
  size?: number
}

export function Spinner({ size = 16, className, ...props }: SpinnerProps) {
  return (
    <Loader2
      className={cn("animate-spin text-primary", className)}
      size={size}
      aria-hidden
      {...(props as object)}
    />
  )
}

// ============================================================
// Skeleton — bloque de "cargando..." con pulse.
// Patron shadcn: bg-muted rounded-md + animate-pulse.
// ============================================================

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Forma. Default 'box'. */
  shape?: "box" | "text" | "circle"
}

export function Skeleton({ shape = "box", className, ...props }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Cargando..."
      className={cn(
        "animate-pulse bg-muted",
        shape === "circle" ? "rounded-full" : "rounded-md",
        shape === "text" ? "h-3 w-full" : "",
        className
      )}
      {...props}
    />
  )
}

// ============================================================
// SkeletonText — lineas de texto (para parrafos).
// ============================================================

interface SkeletonTextProps {
  /** Cantidad de lineas. Default 3. */
  lines?: number
  /** Ultima linea mas corta (ancho %). Default 60. */
  lastLineWidth?: number
  className?: string
}

export function SkeletonText({
  lines = 3,
  lastLineWidth = 60,
  className
}: SkeletonTextProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          shape="text"
          className={i === lines - 1 ? `h-3 w-[${lastLineWidth}%]` : "h-3 w-full"}
        />
      ))}
    </div>
  )
}

// ============================================================
// SkeletonTable — esqueleto de filas de tabla.
// ============================================================

interface SkeletonTableProps {
  rows?: number
  cols?: number
  className?: string
}

export function SkeletonTable({
  rows = 5,
  cols = 4,
  className
}: SkeletonTableProps) {
  return (
    <div
      role="status"
      aria-label="Cargando tabla..."
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
    >
      <div className="overflow-x-auto">
        <div className="w-full min-w-[600px] p-3">
          {/* Header */}
          <div className="mb-3 flex gap-3 border-b border-border pb-3">
            {Array.from({ length: cols }).map((_, i) => (
              <Skeleton key={`h-${i}`} className="h-3 flex-1" />
            ))}
          </div>
          {/* Rows */}
          {Array.from({ length: rows }).map((_, r) => (
            <div key={`r-${r}`} className="mb-2 flex gap-3">
              {Array.from({ length: cols }).map((_, c) => (
                <Skeleton
                  key={`c-${r}-${c}`}
                  className="h-4 flex-1"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// SkeletonCard — bloque estilo card (titulo + lineas).
// ============================================================

interface SkeletonCardProps {
  className?: string
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Cargando tarjeta..."
      className={cn(
        "rounded-lg border border-border bg-card p-6",
        className
      )}
    >
      <Skeleton className="mb-3 h-4 w-1/3" />
      <SkeletonText lines={3} />
    </div>
  )
}

// ============================================================
// SkeletonKpis — para el dashboard (KPI cards en grid).
// ============================================================

interface SkeletonKpisProps {
  count?: number
  className?: string
}

export function SkeletonKpis({ count = 4, className }: SkeletonKpisProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-4"
          role="status"
          aria-label="Cargando KPI..."
        >
          <Skeleton className="mb-2 h-3 w-1/2" />
          <Skeleton className="h-7 w-3/4" />
        </div>
      ))}
    </div>
  )
}

// ============================================================
// PageSpinner — pantalla completa con logo AFM + spinner.
// Para usar como fallback de <Suspense> en pages con data pesada.
// ============================================================

interface PageSpinnerProps {
  /** Mensaje opcional debajo del spinner. */
  message?: string
  className?: string
}

export function PageSpinner({ message, className }: PageSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6",
        className
      )}
    >
      <div className="relative">
        {/* Anillo de fondo */}
        <div className="size-16 rounded-full border-4 border-muted" />
        {/* Anillo activo (gira) */}
        <div className="absolute inset-0 size-16 animate-spin rounded-full border-4 border-transparent border-t-primary" />
        {/* Logo AFM al centro (placeholder) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-extrabold text-primary">A</span>
        </div>
      </div>
      {message ? (
        <p className="text-sm text-muted-foreground">{message}</p>
      ) : null}
    </div>
  )
}

// ============================================================
// SpinnerInline — para usar DENTRO de un boton o link.
// Renderiza un Spinner chico con el tamano del contexto.
// ============================================================

interface SpinnerInlineProps {
  className?: string
}

export function SpinnerInline({ className }: SpinnerInlineProps) {
  return <Spinner size={14} className={cn("mr-1.5", className)} />
}
