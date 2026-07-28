"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input — input accesible con label autogenerado, hint e invalid.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/input.tsx`):
 *   - Wrapper de `InputPrimitive` de `@base-ui/react/input` (en lugar de
 *     `<input>` nativo) — hereda el polyfill de estilos y soporte de
 *     `form` integration.
 *   - Wrapper HTML de este proyecto que agrega `label`, `hint`, `invalid`
 *     (el V0 sólo expone el `<input>` pelado; acá extendemos con los
 *     patrones de `FieldSelect` para mantener consistencia).
 *
 * Accesibilidad:
 *   - `useId()` autogenera el `id` del input cuando el caller no pasa uno
 *     explícito. El id se usa para `htmlFor` del label, `aria-describedby`
 *     del hint y `aria-errormessage` cuando es inválido.
 *   - El label es `<label htmlFor>` real (NO un `<div>`) → screen readers
 *     lo leen al focus del input.
 *   - `aria-invalid` se setea con `invalid={true}`.
 *   - `aria-describedby` apunta al hint cuando se pasa.
 *   - Si `hint` se renderiza con `id=${id}-hint`, screen readers lo leen
 *     después del label al focus.
 *
 * @example
 *   <Input label="Email" type="email" placeholder="tu@empresa.com" />
 *   <Input label="Hectáreas" hint="Aprox. 1 decimal" invalid={hasError} />
 */
export interface InputProps extends Omit<React.ComponentProps<"input">, "id"> {
  /** Etiqueta del campo. Requerida para accesibilidad. */
  label: React.ReactNode;
  /** Texto de ayuda bajo el input (mostrado y conectado con `aria-describedby`). */
  hint?: React.ReactNode;
  /** Marca el campo como inválido (`aria-invalid` + border destructive). */
  invalid?: boolean;
  /** id explícito (opcional). Si se omite, se genera con `useId()`. */
  id?: string;
  /** className adicional del wrapper (no del input). */
  wrapperClassName?: string;
}

function Input({
  label,
  hint,
  invalid,
  className,
  id,
  wrapperClassName,
  type = "text",
  ...props
}: InputProps) {
  const auto = React.useId();
  const inputId = id ?? `input-${auto}`;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </label>
      <InputPrimitive
        id={inputId}
        type={type}
        data-slot="input"
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border bg-card px-2.5 py-1 text-sm text-foreground outline-none transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground",
          invalid
            ? "border-destructive ring-3 ring-destructive/20"
            : "border-input focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-input/50",
          "md:text-sm",
          "dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export { Input };
