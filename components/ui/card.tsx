import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card + subcomponents — primitive de card con grid pattern de V0.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/card.tsx`):
 *   - `Card` es el contenedor. Soporta variant de tamaño `default` (p-4) o `sm` (p-3).
 *   - Espaciado interno controlado por CSS var `--card-spacing` (no hardcodeado
 *     en cada subcomponente → un solo lugar para tunear).
 *   - `CardHeader` es un grid auto-rows-min; si tiene `CardAction` se vuelve
 *     2 cols (1fr + auto). Si tiene `CardDescription` se vuelve 2 rows.
 *   - `CardFooter` con border-top + bg-muted/50, anula el padding-bottom
 *     del Card (has-data-[slot=card-footer]:pb-0).
 *   - Si la card arranca con un `<img>`, se quita el padding-top
 *     (has-[>img:first-child]:pt-0) y la imagen se redondea
 *     (*:[img:first-child]:rounded-t-xl).
 *
 * Accesibilidad:
 *   - `<div>` semánticamente neutro (no usamos `<article>` a propósito:
 *     la card es un agrupador visual, no un item de feed).
 *   - `data-slot` en cada subcomponente para que styles compound via
 *     `has-data-[slot=...]` (no necesitamos variant de padding en cada
 *     sitio que usa Card).
 *
 * @example
 *   <Card size="sm">
 *     <CardHeader>
 *       <CardTitle>Fumigación 1234</CardTitle>
 *       <CardDescription>Lote 5 — 12.4 ha</CardDescription>
 *       <CardAction><Button size="icon-sm">×</Button></CardAction>
 *     </CardHeader>
 *     <CardContent>...</CardContent>
 *     <CardFooter>
 *       <span>Hace 3 días</span>
 *       <Button size="sm">Ver detalle</Button>
 *     </CardFooter>
 *   </Card>
 */

function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
        className
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent
};
