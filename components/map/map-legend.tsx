"use client";

/**
 * components/map/map-legend.tsx
 *
 * M3-M5 Track A (commit 3): leyenda visual del mapa con grupos semánticos.
 * Antes era 3 entries planos (parcels, flights, alerts). Ahora son 3 grupos
 * con role="group" + aria-label descriptivo:
 *   - "Parcelas"   → toggle parcels + 3 indicadores visuales
 *                    (fumigadas, sin fumigar, orchards).
 *   - "Alertas"    → toggle alerts + 3 indicadores visuales
 *                    (alta, media, baja) usando los tonos de `getStatusTone`.
 *   - "Vuelos"     → toggle flights.
 *
 * Los indicadores visuales NO son toggles (sin checkbox) — son reference
 * visual para que el operador identifique el color/patrón que ve en el mapa.
 *
 * Reglas del repo:
 *   - Hex vienen de `lib/ui-tokens.ts` (COLORS.*), nunca inline.
 *   - a11y: region + group con aria-label, todos los inputs con label
 *     asociado por estructura (label > input + span).
 */

import { COLORS } from "@/lib/ui-tokens";

export interface MapLayersState {
  parcels: boolean;
  flights: boolean;
  alerts: boolean;
}

export type MapLayerKey = keyof MapLayersState;

export interface MapLegendProps {
  layers: MapLayersState;
  onToggle: (key: MapLayerKey) => void;
  ariaLabel?: string;
}

interface VisualIndicator {
  /** Texto visible (case-insensitive match en tests). */
  label: string;
  /** Color sólido del dot (CSS). */
  color: string;
  /** Si el dot debe mostrarse con borde dashed (parcelas sin fumigar). */
  dashed?: boolean;
}

const PARCEL_INDICATORS: VisualIndicator[] = [
  { label: "Fumigadas", color: COLORS.primary },
  { label: "Sin fumigar", color: COLORS.primary, dashed: true },
  { label: "Orchards", color: COLORS.warning }
];

const ALERT_INDICATORS: VisualIndicator[] = [
  { label: "Alta", color: COLORS.danger },
  { label: "Media", color: COLORS.warning },
  { label: "Baja", color: COLORS.success }
];

/**
 * Indicador visual (dot) — NO es toggle. Sirve como referencia para
 * que el operador asocie color/patrón del mapa con la semántica.
 */
function VisualDot({
  indicator
}: {
  indicator: VisualIndicator;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full"
      style={{
        backgroundColor: indicator.color,
        ...(indicator.dashed ? { borderStyle: "dashed", borderWidth: "1px", borderColor: indicator.color } : {})
      }}
    />
  );
}

/**
 * Fila de indicador visual (label + dot), contenida en un grupo semántico.
 */
function IndicatorRow({ indicator }: { indicator: VisualIndicator }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#4a5b50]">
      <VisualDot indicator={indicator} />
      <span>{indicator.label}</span>
    </div>
  );
}

/**
 * Toggle de capa (checkbox) con label inline.
 */
function LayerToggle({
  layerKey,
  label,
  checked,
  onToggle
}: {
  layerKey: MapLayerKey;
  label: string;
  checked: boolean;
  onToggle: (key: MapLayerKey) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase text-[#4a5b50]">
      <input
        checked={checked}
        className="h-3.5 w-3.5 cursor-pointer rounded text-[#0b5f2d] focus:ring-[#0b5f2d]"
        onChange={() => onToggle(layerKey)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * Grupo semántico con role="group" y aria-label. Contiene toggles +
 * indicadores visuales relacionados.
 */
function LegendGroup({
  ariaLabel,
  children
}: {
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className="flex flex-col gap-2"
      role="group"
    >
      {children}
    </div>
  );
}

/**
 * Leyenda visual de las capas del mapa.
 * Estructura a11y:
 *   <section role="region" aria-label="Leyenda del mapa">
 *     <div role="group" aria-label="Parcelas"> ... </div>
 *     <div role="group" aria-label="Alertas">  ... </div>
 *     <div role="group" aria-label="Vuelos">   ... </div>
 *   </section>
 */
export function MapLegend({ layers, onToggle, ariaLabel = "Leyenda del mapa" }: MapLegendProps) {
  return (
    <section
      aria-label={ariaLabel}
      className="flex flex-col gap-4 rounded-xl border border-[#d2ddd6] bg-white px-4 py-3 shadow-lg"
      role="region"
    >
      {/* Grupo: Parcelas — toggle + 3 indicadores visuales */}
      <LegendGroup ariaLabel="Parcelas">
        <LayerToggle
          checked={layers.parcels}
          label="Capa de parcelas"
          layerKey="parcels"
          onToggle={onToggle}
        />
        <div className="flex flex-col gap-1 pl-5">
          {PARCEL_INDICATORS.map((ind) => (
            <IndicatorRow indicator={ind} key={ind.label} />
          ))}
        </div>
      </LegendGroup>

      {/* Grupo: Vuelos — solo toggle (la capa se visualiza sola, sin categorías) */}
      <LegendGroup ariaLabel="Vuelos">
        <LayerToggle
          checked={layers.flights}
          label="Vuelos"
          layerKey="flights"
          onToggle={onToggle}
        />
      </LegendGroup>

      {/* Grupo: Alertas — toggle + 3 indicadores visuales (danger/warning/success) */}
      <LegendGroup ariaLabel="Alertas">
        <LayerToggle
          checked={layers.alerts}
          label="Capa de alertas"
          layerKey="alerts"
          onToggle={onToggle}
        />
        <div className="flex flex-col gap-1 pl-5">
          {ALERT_INDICATORS.map((ind) => (
            <IndicatorRow indicator={ind} key={ind.label} />
          ))}
        </div>
      </LegendGroup>
    </section>
  );
}
