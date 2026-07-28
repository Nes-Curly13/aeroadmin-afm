"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ToggleButton — botón toggle accesible con `aria-pressed`.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/geovisor/geovisor-client.tsx`):
 *   - `aria-pressed` para estado on/off (más accesible que checkbox)
 *   - `aria-label` opcional para iconos sin texto
 *   - Variantes: `default`, `outline`, `pill` (con dot de color)
 *
 * Uso típico:
 *   - Filtros de status de cadencia (crítico, vencido, etc.)
 *   - Filtros de source (djiscraper, import, manual)
 *   - Selector de mapa base (satélite / calles)
 *
 * Accesibilidad:
 *   - Es un `<button type="button">` (no submit).
 *   - `aria-pressed` se setea con el `pressed` prop.
 *   - Focus visible ring (3px ring/50).
 *   - `disabled` se maneja.
 *
 * @example
 *   <ToggleButton
 *     pressed={active}
 *     onPressedChange={setActive}
 *     dotColor="#fbbf24"
 *   >
 *     Crítico
 *   </ToggleButton>
 */
export type ToggleButtonVariant = "default" | "outline" | "pill";

export interface ToggleButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Estado pressed (on). */
  pressed: boolean;
  /** Callback al cambiar. */
  onPressedChange: (pressed: boolean) => void;
  /** Variante visual. */
  variant?: ToggleButtonVariant;
  /** Color del dot (solo variante pill). */
  dotColor?: string;
  /** Label accesible adicional (e.g. cuando solo hay icono). */
  "aria-label"?: string;
}

const variantClasses: Record<ToggleButtonVariant, string> = {
  default: cn(
    "h-7 border border-transparent",
    "data-[pressed=true]:bg-primary data-[pressed=true]:text-primary-foreground data-[pressed=true]:border-primary",
    "data-[pressed=false]:hover:bg-muted"
  ),
  outline: cn(
    "h-7 border border-border bg-background",
    "data-[pressed=true]:bg-foreground data-[pressed=true]:text-background data-[pressed=true]:border-foreground",
    "data-[pressed=false]:hover:bg-muted"
  ),
  pill: cn(
    "h-7 rounded-full border",
    "data-[pressed=true]:bg-foreground data-[pressed=true]:text-background data-[pressed=true]:border-transparent",
    "data-[pressed=false]:border-border data-[pressed=false]:hover:bg-muted"
  )
};

export const ToggleButton = React.forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton(
    {
      pressed,
      onPressedChange,
      variant = "default",
      dotColor,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onPressedChange(!pressed)}
        data-pressed={pressed}
        data-slot="toggle-button"
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {dotColor ? (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden
          />
        ) : null}
        {children}
      </button>
    );
  }
);
