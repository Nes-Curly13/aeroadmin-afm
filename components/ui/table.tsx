import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Table + subcomponents — primitive de tabla HTML semántica.
 *
 * Patrón copiado del V0 (`docs/fumigation-management-dashboard/components/ui/table.tsx`):
 *   - HTML semántico puro (`<table>`, `<thead>`, `<tbody>`, `<tr>`, etc.).
 *     Sin ARIA porque los tags ya tienen los roles correctos.
 *   - `Table` envuelve en un `<div data-slot="table-container">` con
 *     `overflow-x-auto` → scroll horizontal en mobile sin tocar la tabla.
 *   - `data-slot` en cada subcomponente para que styles compongan via
 *     `has-data-[slot=table-head]` etc. desde fuera.
 *
 * Accesibilidad:
 *   - `TableCaption` se renderiza como `<caption>` (NO un `<div>` arriba)
 *     para que screen readers lo anuncien al entrar a la tabla.
 *   - Headers (`<th>`) tienen `text-left` + `whitespace-nowrap` para que
 *     la columna sea predecible; `text-foreground` para que se distingan
 *     de celdas de datos.
 *   - Rows con `hover:bg-muted/50` + `has-aria-expanded:bg-muted/50`
 *     (para filas con disclosure que estén expandidas).
 *   - `data-[state=selected]` para filas seleccionadas.
 *
 * @example
 *   <Table>
 *     <TableCaption>Fumigaciones de la última semana</TableCaption>
 *     <TableHeader>
 *       <TableRow>
 *         <TableHead>Fecha</TableHead>
 *         <TableHead>Lote</TableHead>
 *         <TableHead>ha</TableHead>
 *       </TableRow>
 *     </TableHeader>
 *     <TableBody>
 *       <TableRow>
 *         <TableCell>2026-07-28</TableCell>
 *         <TableCell>5</TableCell>
 *         <TableCell>12.4</TableCell>
 *       </TableRow>
 *     </TableBody>
 *   </Table>
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption
};
