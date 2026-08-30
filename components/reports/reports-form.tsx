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
  /**
   * Sprint S9.2 (2026-08-29) — feature/s9-2-reports-date-range.
   * URLs precomputadas por la página para cada preset de rango
   * rápido. Cada URL preserva el filtro `farm` si está activo y
   * cambia solo `from`/`to`. El botón "Por defecto" resetea a
   * los últimos 30 días (mismo que el default del form).
   */
  presets: {
    "7d": string;
    "30d": string;
    "90d": string;
    month: string;
    year: string;
    defaultWindow: string;
  };
}

export function ReportsForm({
  defaults,
  farmOptions,
  pdfHref,
  csvHref,
  presets
}: ReportsFormProps) {
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

      {/**
       * Sprint S9.2 — quick-range buttons. Cada botón es un `<a>`
       * precomputado por la página (URL ya incluye from/to/farm).
       * El navegador navega a la URL → re-fetch server-side con
       * los nuevos query params. Sin JS state, sin cliente-side
       * router. Cero hydration. 1 click = 1 round-trip server.
       */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Período:
        </span>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={presets["7d"]} aria-label="Últimos 7 días">7d</a>}
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={presets["30d"]} aria-label="Últimos 30 días">30d</a>}
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={presets["90d"]} aria-label="Últimos 90 días">90d</a>}
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={presets.month} aria-label="Mes actual">Mes</a>}
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<a href={presets.year} aria-label="Año actual">Año</a>}
        />
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={
            <a href={presets.defaultWindow} aria-label="Volver al rango por defecto (últimos 30 días)">
              Por defecto
            </a>
          }
        />
      </div>

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
