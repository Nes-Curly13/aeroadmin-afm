"use client";

import { useState } from "react";

import { COLORS } from "@/lib/ui-tokens";

/**
 * components/map/map-legend.tsx
 *
 * v1.8 — leyenda visual del mapa con **4 estados** + **modo colapsable**.
 *
 * Cambio respecto a v1.7:
 *   - Antes: 3 grupos semánticos (Parcelas / Vuelos / Alertas) con
 *     checkboxes para toggle de capa + indicadores visuales por grupo.
 *   - Ahora: 4 indicadores visuales que explican el color/status de
 *     cada geometría en el mapa:
 *       1. **Parcela activa**  → fumigada en los últimos 6m (verde
 *          sólido, `COLORS.primary`).
 *       2. **Parcela inactiva** → sin fumigación reciente (gris con
 *          dashed border, `COLORS.neutral-medium`).
 *       3. **En vuelo**         → flight point cuyo `start_at` está
 *          dentro de la última hora (azul, `COLORS.info`).
 *       4. **Completado**       → flight point más viejo que 1h
 *          (morado, token dedicado `COLORS.completed`).
 *   - El panel es **colapsable** (default abierto) — el operador
 *     puede esconderlo si quiere ver el mapa "limpio".
 *   - **NO incluye toggles de capa** — eso vive en el `<LayersControl>`
 *     de Leaflet (es la UI canónica para ese caso). Mezclar toggles
 *     y leyenda visual era ruido.
 *
 * Decisiones a11y:
 *   - Region + grupo con `role="region"` y `aria-label="Leyenda del mapa"`.
 *   - El collapse es un `<button aria-expanded>` que controla el grupo
 *     de indicadores (id estable para `aria-controls`).
 *   - Los indicadores visuales son `<span aria-hidden="true">` con
 *     texto adyacente accesible (lectores de pantalla leen el label).
 *
 * Tokens:
 *   - Los 4 colores vienen de `lib/ui-tokens.ts` (single source of truth).
 *     El "Completado" (morado) es un token nuevo agregado en v1.8 —
 *     no estaba en el design system previo.
 */

export interface MapLegendProps {
  /**
   * Si `true`, el panel arranca colapsado. Default: `false` (mostrado).
   * El usuario puede toggearlo con el chevron del header.
   */
  defaultCollapsed?: boolean;
  /** ARIA label del contenedor principal. */
  ariaLabel?: string;
}

interface VisualIndicator {
  /** Texto visible (case-insensitive match en tests). */
  label: string;
  /** Color sólido del dot (CSS). */
  color: string;
  /** Si el dot debe mostrarse con borde dashed (parcelas inactivas). */
  dashed?: boolean;
}

const PARCEL_ACTIVE: VisualIndicator = {
  label: "Parcela activa",
  color: COLORS.primary
};

const PARCEL_INACTIVE: VisualIndicator = {
  label: "Parcela inactiva",
  color: COLORS["neutral-medium"],
  dashed: true
};

const FLIGHT_IN_PROGRESS: VisualIndicator = {
  label: "En vuelo",
  color: COLORS.info
};

const FLIGHT_COMPLETED: VisualIndicator = {
  label: "Completado",
  color: COLORS.completed
};

const LEGEND_ITEMS: VisualIndicator[] = [
  PARCEL_ACTIVE,
  PARCEL_INACTIVE,
  FLIGHT_IN_PROGRESS,
  FLIGHT_COMPLETED
];

/**
 * Indicador visual (dot) — NO es toggle. Sirve como referencia para
 * que el operador asocie color/patrón del mapa con la semántica.
 */
function VisualDot({ indicator }: { indicator: VisualIndicator }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full"
      style={{
        backgroundColor: indicator.color,
        ...(indicator.dashed
          ? { borderStyle: "dashed", borderWidth: "1px", borderColor: indicator.color }
          : {})
      }}
    />
  );
}

/**
 * Fila de indicador visual (label + dot).
 */
function IndicatorRow({ indicator }: { indicator: VisualIndicator }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#4a5b50]">
      <VisualDot indicator={indicator} />
      <span>{indicator.label}</span>
    </div>
  );
}

const DEFAULT_LABEL = "Leyenda del mapa";
const CONTENT_ID = "map-legend-content";

export function MapLegend({
  defaultCollapsed = false,
  ariaLabel = DEFAULT_LABEL
}: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section
      aria-label={ariaLabel}
      className="flex w-56 flex-col gap-3 rounded-2xl border border-[#d2ddd6] bg-white p-4 shadow-[0px_18px_40px_rgba(15,23,42,0.18)]"
      data-testid="map-legend"
      role="region"
    >
      {/* Header colapsable */}
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[#121815]">
          Leyenda
        </h2>
        <button
          aria-controls={CONTENT_ID}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir leyenda" : "Colapsar leyenda"}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#e2e8e0] bg-white text-[#4a5b50] transition hover:bg-[#f4f7f4] hover:text-[#0b5f2d] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]/40"
          data-testid="map-legend-toggle"
          onClick={() => setCollapsed((c) => !c)}
          type="button"
        >
          <span aria-hidden="true" className="text-xs leading-none">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
      </header>

      {/* Contenido: 4 indicadores visuales */}
      {!collapsed ? (
        <div
          aria-label="Indicadores de estado"
          className="flex flex-col gap-2"
          data-testid="map-legend-content"
          id={CONTENT_ID}
        >
          {LEGEND_ITEMS.map((ind) => (
            <IndicatorRow indicator={ind} key={ind.label} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
