"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch — toggle switch accesible con `role="switch"` + `aria-checked`.
 *
 * Diferencia con `ToggleButton`:
 *   - `Switch` usa `role="switch"` + `aria-checked` (WCAG APG correcto para
 *     toggles binarios persistentes: settings, prefs, capas del mapa).
 *   - `ToggleButton` usa `aria-pressed` (para filtros on/off en toolbars).
 *   - Si necesitás un toggle binario con label visible, usá `Switch`.
 *   - Si necesitás un toggle tipo "filtro multi-select en toolbar", usá
 *     `ToggleButton` con `variant="pill"`.
 *
 * Accesibilidad:
 *   - `role="switch"` para que screen readers lo lean como switch.
 *   - `aria-checked` (semánticamente lo correcto para role=switch).
 *   - Focus visible ring (3px).
 *   - `aria-label` opcional si el texto no es visible.
 *   - Thumb con `ring-1 ring-border/30` para mejor definición sobre
 *     tracks de bajo contraste.
 *
 * @example
 *   <Switch
 *     checked={showLabels}
 *     onCheckedChange={setShowLabels}
 *     label="Etiquetas de suerte"
 *   />
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  /** Estado checked. */
  checked: boolean;
  /** Callback al cambiar. */
  onCheckedChange: (checked: boolean) => void;
  /** Label visible (texto a la izquierda del switch). Si se omite, queda
   *  solo el track (usar `aria-label` para hacerlo accesible). */
  label?: React.ReactNode;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch(
    { checked, onCheckedChange, label, className, disabled, ...props },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        data-slot="switch"
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs outline-none",
          "hover:bg-muted",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        {...props}
      >
        {label ? (
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        ) : null}
        <span
          className={cn(
            "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
            checked ? "bg-primary" : "bg-muted-foreground/50"
          )}
          aria-hidden
        >
          <span
            className={cn(
              "size-3 rounded-full bg-card shadow-sm ring-1 ring-border/30 transition-transform",
              checked && "translate-x-3"
            )}
          />
        </span>
      </button>
    );
  }
);
