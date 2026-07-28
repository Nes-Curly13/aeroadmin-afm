import { Droplets, Plane, Ruler, Sprout, type LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tipos de KPI predefinidos para el mapa.
 *
 * - `aplicaciones`: cuenta de fumigaciones
 * - `hectareas`: ha tratadas (icono Ruler, no MapPin — área ≠ punto)
 * - `volumen`: volumen asperjado (L)
 * - `vuelos`: count de sorties
 *
 * Cada tipo trae su icono y label. Si el caller quiere custom, puede
 * pasar `{ icon, label, value }` directo en `items`.
 */
export type KpiPillKind = "aplicaciones" | "hectareas" | "volumen" | "vuelos";

const KIND_META: Record<KpiPillKind, { icon: LucideIcon; label: string }> = {
  aplicaciones: { icon: Sprout, label: "Aplicaciones" },
  hectareas: { icon: Ruler, label: "Hectáreas tratadas" },
  volumen: { icon: Droplets, label: "Volumen" },
  vuelos: { icon: Plane, label: "Vuelos" }
};

export interface KpiPillItem {
  /** Tipo predefinido (trae icono + label). */
  kind?: KpiPillKind;
  /** Icono custom (override del kind). */
  icon?: LucideIcon;
  /** Label custom (override del kind). */
  label?: string;
  /** Valor ya formateado (string o number). Se renderiza con `tabular-nums`. */
  value: string | number;
}

export interface KpiPillProps {
  /** Lista de KPIs a mostrar. */
  items: KpiPillItem[];
  /** className adicional del contenedor. */
  className?: string;
  /** Si true (default), los items se separan con divider vertical que
   *  sobrevive al wrap (gap-px + bg-border). Si false, sin divider. */
  divided?: boolean;
}

/**
 * KpiPill — barra de KPIs compacta para overlay sobre el mapa.
 *
 * Patrón del V0: 4 KPIs en una sola pill horizontal, divididos por
 * un divider vertical. Encima del mapa con backdrop-blur.
 *
 * Accesibilidad:
 *   - Cada KPI tiene label uppercase + value con `tabular-nums`.
 *   - Iconos decorativos con `aria-hidden` (lucide-react lo emite por default).
 *   - `role="group"` + `aria-label` en el contenedor para que screen
 *     readers anuncien el grupo entero.
 *
 * Decisión visual (fix review ui-ux-pro-max):
 *   - Divider se implementa con `gap-px` + `bg-border` en el contenedor
 *     y `bg-card` en cada item. Sobrevive al wrap (no se generan
 *     líneas fantasma entre filas como con `divide-x`).
 *   - Icono `hectareas` es `Ruler` (semánticamente correcto: área
 *     no es un punto de mapa).
 *
 * @example
 *   <KpiPill
 *     items={[
 *       { kind: "aplicaciones", value: 12 },
 *       { kind: "hectareas", value: "34.5 ha" },
 *       { kind: "volumen", value: "123 L" },
 *       { kind: "vuelos", value: 5 }
 *     ]}
 *   />
 */
export function KpiPill({ items, className, divided = true }: KpiPillProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex flex-wrap items-stretch overflow-hidden rounded-md border border-border shadow-sm backdrop-blur",
        divided ? "gap-px bg-border" : "gap-0",
        className
      )}
      role="group"
      aria-label="Resumen del filtro actual"
      data-slot="kpi-pill"
    >
      {items.map((item) => {
        const meta = item.kind ? KIND_META[item.kind] : null;
        const Icon = item.icon ?? meta?.icon;
        const label = item.label ?? meta?.label ?? "";
        return (
          <div
            key={item.kind ?? item.label}
            className="flex items-center gap-2.5 bg-card/95 px-3 py-2"
          >
            {Icon ? <Icon className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {item.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
