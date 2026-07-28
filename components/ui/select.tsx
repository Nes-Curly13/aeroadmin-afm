"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Select — primitive de select accesible basado en @base-ui/react/select.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/select.tsx`):
 *   - Wrapper de `Select` de `@base-ui/react/select` (Combobox-like,
 *     keyboard-navigable, type-ahead, virtualizable).
 *   - `Select` (Root) maneja estado (value/onValueChange).
 *   - `SelectTrigger` renderiza el botón disparador con chevron.
 *   - `SelectContent` (composite) = Portal + Positioner + Popup + ScrollArrows.
 *     El caller lo usa como un solo bloque; internamente compone los
 *     sub-primitives de @base-ui.
 *   - `SelectValue` muestra el label del item seleccionado.
 *   - `SelectGroup` + `SelectLabel` agrupan items con título.
 *   - `SelectItem` + `SelectItemIndicator` (check a la derecha cuando activo).
 *
 * Accesibilidad:
 *   - Roles y keyboard nav los maneja @base-ui (WAI-ARIA APG compliant).
 *   - `aria-invalid` se propaga del Trigger al border destructive.
 *   - `data-placeholder:text-muted-foreground` para texto placeholder.
 *   - `select-none` en el Trigger para que el click no seleccione texto.
 *
 * Iconos (lucide-react):
 *   - ChevronDown (trigger) — decorativo, `aria-hidden`.
 *   - ChevronUp / ChevronDown (scroll arrows) — decorativos.
 *   - Check (item indicator) — sólo visible cuando item está activo.
 *
 * @example
 *   <Select value={client} onValueChange={setClient}>
 *     <SelectTrigger className="w-48">
 *       <SelectValue placeholder="Seleccionar cliente" />
 *     </SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="acme">ACME</SelectItem>
 *       <SelectItem value="zenith">Zenith</SelectItem>
 *     </SelectContent>
 *   </Select>
 */
const Select = SelectPrimitive.Root;

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & { size?: "sm" | "default" }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-card py-2 pr-2 pl-2.5 text-sm whitespace-nowrap text-foreground outline-none transition-colors select-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-placeholder:text-muted-foreground",
        "data-[size=default]:h-9 data-[size=sm]:h-7",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDown className="pointer-events-none size-4 text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-sm py-1 pr-8 pl-1.5 text-sm outline-hidden select-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <Check className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUp />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDown />
    </SelectPrimitive.ScrollDownArrow>
  );
}

/**
 * Re-exports "raw" de los primitives de @base-ui que no se usan en el
 * composite `SelectContent`, pero pueden ser útiles para casos avanzados
 * (custom layout, popover manual, etc.). Mantener naming consistente
 * con @base-ui/react/select.
 */
const SelectPortal = SelectPrimitive.Portal;
const SelectPositioner = SelectPrimitive.Positioner;
const SelectPopup = SelectPrimitive.Popup;
const SelectItemText = SelectPrimitive.ItemText;
const SelectItemIndicator = SelectPrimitive.ItemIndicator;
const SelectArrow = SelectPrimitive.Arrow;
const SelectIcon = SelectPrimitive.Icon;
const SelectScrollUpArrow = SelectPrimitive.ScrollUpArrow;
const SelectScrollDownArrow = SelectPrimitive.ScrollDownArrow;
const SelectGroupLabel = SelectPrimitive.GroupLabel;
const SelectList = SelectPrimitive.List;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  // raw re-exports
  SelectPortal,
  SelectPositioner,
  SelectPopup,
  SelectItemText,
  SelectItemIndicator,
  SelectArrow,
  SelectIcon,
  SelectScrollUpArrow,
  SelectScrollDownArrow,
  SelectGroupLabel,
  SelectList
};
