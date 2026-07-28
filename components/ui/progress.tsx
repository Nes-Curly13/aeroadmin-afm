"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@/lib/utils";

/**
 * Progress — primitive de barra de progreso accesible.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/progress.tsx`):
 *   - Wrapper de `Progress` de `@base-ui/react/progress`.
 *   - Compone Track + Indicator automáticamente; Label y Value opcionales
 *     para mostrar "X% completado" arriba.
 *   - Default layout: Label + Value en una fila, Track abajo con Indicator
 *     adentro (full width del padre).
 *
 * Accesibilidad:
 *   - Roles y ARIA los maneja @base-ui. `Progress` agrega
 *     `role="progressbar"` + `aria-valuenow/min/max` automáticamente.
 *   - `ProgressLabel` se conecta con `aria-labelledby` al root.
 *   - `ProgressValue` se conecta con `aria-describedby` al root.
 *
 * @example
 *   <Progress value={34}>
 *     <ProgressLabel>Cargando</ProgressLabel>
 *     <ProgressValue />
 *   </Progress>
 */
export interface ProgressProps extends Omit<ProgressPrimitive.Root.Props, "value"> {
  /** Valor 0-100 (o el rango del track). Si se omite, indeterminate. */
  value?: number | null;
}

function Progress({ className, children, value, ...props }: ProgressProps) {
  // @base-ui requiere `value: number | null` (no undefined). Si llega
  // undefined (cuando el caller omite el prop), lo colapsamos a null
  // para que ProgressPrimitive.Root no proteste.
  const normalizedValue = value === undefined ? null : value;
  return (
    <ProgressPrimitive.Root
      value={normalizedValue}
      data-slot="progress"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        "relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      data-slot="progress-track"
      {...props}
    />
  );
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn("h-full bg-primary transition-all", className)}
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn("text-sm font-medium", className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn("ml-auto text-sm text-muted-foreground tabular-nums", className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue };
