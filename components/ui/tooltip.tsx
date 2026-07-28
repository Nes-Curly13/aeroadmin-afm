"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@/lib/utils";

/**
 * Tooltip — primitive de tooltip accesible basado en @base-ui/react/tooltip.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/tooltip.tsx`):
 *   - Wrapper de `Tooltip` de `@base-ui/react/tooltip`.
 *   - `TooltipProvider` controla el delay global (default 0ms en este
 *     primitive, ajustable por caller). Un solo Provider por árbol de
 *     tooltips mejora performance (un solo timeout compartido).
 *   - `TooltipContent` (composite) = Portal + Positioner + Popup + Arrow.
 *     El caller lo usa como un solo bloque.
 *
 * Accesibilidad:
 *   - Roles y hover/focus trigger los maneja @base-ui. Tooltip aparece en
 *     focus o hover del trigger; se cierra con Escape.
 *   - `TooltipTrigger` debe wrappear el elemento focusable (button, link).
 *   - `data-state` se setea en el Popup (`delayed-open` para animación).
 *
 * Animación:
 *   - `data-open:animate-in` + `data-closed:animate-out` para fade/zoom
 *     de entrada/salida (Tailwind animation classes del theme).
 *
 * @example
 *   <TooltipProvider delay={150}>
 *     <Tooltip>
 *       <TooltipTrigger render={<Button variant="ghost" size="icon-sm" />}>
 *         <Info className="size-4" />
 *       </TooltipTrigger>
 *       <TooltipContent>Más información</TooltipContent>
 *     </Tooltip>
 *   </TooltipProvider>
 */
function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-sm",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
            "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow
            className={cn(
              "z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground",
              "data-[side=bottom]:top-1",
              "data-[side=top]:-bottom-2.5",
              "data-[side=left]:top-1/2 data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2",
              "data-[side=right]:top-1/2 data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2"
            )}
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * Re-exports "raw" del primitive Tooltip. Útil para casos donde el caller
 * necesita componer su propio Positioner/Portal (e.g. nested scrollable
 * containers con positioner custom).
 */
const TooltipPortal = TooltipPrimitive.Portal;
const TooltipPositioner = TooltipPrimitive.Positioner;
const TooltipPopup = TooltipPrimitive.Popup;
const TooltipArrow = TooltipPrimitive.Arrow;

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow
};
