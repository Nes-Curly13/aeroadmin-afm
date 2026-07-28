"use client";

import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FieldSelect — select accesible con label autogenerado y chevron.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/field-select.tsx`):
 *   - `<label htmlFor>` correctamente asociado al `<select id>`
 *   - id autogenerado vía `useId()` (estable, no colisiona entre instancias)
 *   - Chevron decorativo con `aria-hidden`
 *   - Estilos consistentes (border, ring focus, height)
 *   - Look "field" (label arriba en uppercase + select compacto abajo)
 *   - Soporte para `hint` (texto de ayuda) y `invalid` (estado de error)
 *
 * Accesibilidad:
 *   - El label es un `<label>` real (NO un `<div>`) para que screen readers
 *     lo lean al focus del select.
 *   - `aria-invalid` se setea cuando `invalid={true}` (border + ring destructive).
 *   - `aria-describedby` apunta al hint cuando se pasa.
 *   - Ring focus `focus-visible:ring-[3px]` para visibilidad (WCAG 2.4.7).
 *
 * @example
 *   <FieldSelect label="Cliente" value={client} onChange={...}>
 *     <option value="todos">Todos</option>
 *     ...
 *   </FieldSelect>
 */
export interface FieldSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Etiqueta del campo. Se usa para el `<label>` y para autogenerar el `id`. */
  label: string;
  /** Texto de ayuda bajo el select (mostrado y conectado con `aria-describedby`). */
  hint?: React.ReactNode;
  /** Marca el campo como inválido (`aria-invalid` + border destructive). */
  invalid?: boolean;
}

export const FieldSelect = React.forwardRef<HTMLSelectElement, FieldSelectProps>(
  function FieldSelect(
    { label, hint, invalid, className, id, children, ...props },
    ref
  ) {
    const auto = React.useId();
    const selectId = id ?? `field-${auto}`;
    const hintId = hint ? `${selectId}-hint` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={selectId}
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            aria-invalid={invalid || undefined}
            aria-describedby={hintId}
            className={cn(
              "h-9 w-full appearance-none rounded-md border bg-card pl-2.5 pr-8 text-sm text-foreground outline-none",
              invalid ? "border-destructive" : "border-input",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
              "disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {hint ? (
          <p id={hintId} className="text-[11px] text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
