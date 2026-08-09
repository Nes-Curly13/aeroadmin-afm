// components/reports/reports-form.tsx
//
// Form de filtros para la página /reportes. Client component mínimo:
// usa HTML nativo (form method=GET) para que la URL se actualice con
// los query params, lo que triggea el re-fetch server-side.
//
// feature/reports-level-2 (2026-08-08).

"use client";

import { Button } from "@/components/ui/button";
import { Calendar, FileText, FileSpreadsheet, Search } from "lucide-react";

interface FarmsOption {
  name: string;
  count: number;
}

export interface ReportsFormProps {
  /** Defaults para los inputs (los query params actuales). */
  defaults: {
    from: string;
    to: string;
    farm: string;
  };
  /** Lista de haciendas distintas (para el dropdown). */
  farmOptions: FarmsOption[];
  /** URL para el botón PDF (preserva los filtros en query string). */
  pdfHref: string;
  /** URL para el botón CSV. */
  csvHref: string;
}

export function ReportsForm({ defaults, farmOptions, pdfHref, csvHref }: ReportsFormProps) {
  return (
    <div className="flex flex-col gap-3">
      <form
        method="GET"
        action="/reportes"
        className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Desde
          </span>
          <input
            type="date"
            name="from"
            defaultValue={defaults.from}
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Hasta
          </span>
          <input
            type="date"
            name="to"
            defaultValue={defaults.to}
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Hacienda
          </span>
          <select
            name="farm"
            defaultValue={defaults.farm}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
          >
            <option value="">Todas</option>
            {farmOptions.map((f) => (
              <option key={f.name} value={f.name}>
                {`${f.name} (${f.count})`}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button
            type="submit"
            size="sm"
            className="h-9 w-full"
            render={
              <>
                <Search className="size-3.5" aria-hidden />
                Filtrar
              </>
            }
          />
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Descargar:</span>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <a href={pdfHref} download aria-label="Descargar reporte PDF">
              <FileText className="size-3.5" aria-hidden />
              PDF
            </a>
          }
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <a href={csvHref} download aria-label="Descargar reporte CSV">
              <FileSpreadsheet className="size-3.5" aria-hidden />
              CSV
            </a>
          }
        />
      </div>
    </div>
  );
}
