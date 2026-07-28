"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Tabs — primitive de tabs accesible basado en @base-ui/react/tabs.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/tabs.tsx`):
 *   - Wrapper de `Tabs` de `@base-ui/react/tabs` (WAI-ARIA APG compliant,
 *     keyboard nav, roving tabindex automático).
 *   - Variants de `TabsList`:
 *     - `default` (default) — fondo `bg-muted` con items como botones
 *       sólidos, indicador del activo = `bg-background` (efecto pill).
 *     - `line` — sin fondo, indicador = `::after` underline animado
 *       (`after:bg-foreground`).
 *   - `Tabs` Root soporta `orientation="horizontal" | "vertical"`
 *     (default horizontal). El layout flex pasa a `flex-col` o
 *     `flex-row` según orientación.
 *
 * Accesibilidad:
 *   - Roles y keyboard los maneja @base-ui (Tab key cicla, Home/End van
 *     al primer/último, etc.).
 *   - `TabsTrigger` es un `<button>` con `aria-selected` automático.
 *   - `TabsContent` es un panel con `role="tabpanel"` y `aria-labelledby`
 *     apuntando al trigger.
 *   - `data-active` se setea en el trigger activo (usado para estilo).
 *
 * @example
 *   <Tabs defaultValue="resumen">
 *     <TabsList variant="line">
 *       <TabsTrigger value="resumen">Resumen</TabsTrigger>
 *       <TabsTrigger value="historial">Historial</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="resumen">...</TabsContent>
 *     <TabsContent value="historial">...</TabsContent>
 *   </Tabs>
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-9 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface TabsListProps
  extends TabsPrimitive.List.Props,
    VariantProps<typeof tabsListVariants> {}

function TabsList({ className, variant = "default", ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "hover:text-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        "has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "dark:text-muted-foreground dark:hover:text-foreground",
        "group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // Default variant: pill background
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        // Line variant: underline after pseudo-element
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity",
        "group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5",
        "group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5",
        "group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

// Re-exports raw para consumidores que quieran control total
const TabsIndicator = TabsPrimitive.Indicator;
const TabsPanel = TabsPrimitive.Panel;

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator, TabsPanel, tabsListVariants };
