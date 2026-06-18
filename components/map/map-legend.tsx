"use client";

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

interface LayerEntry {
  key: MapLayerKey;
  label: string;
  color: string;
}

const LAYERS: LayerEntry[] = [
  { key: "parcels", label: "Geometry", color: "#0b5f2d" },
  { key: "flights", label: "Summaries", color: "#c7a43a" },
  { key: "alerts", label: "Alerts", color: "#a93232" }
];

/**
 * Leyenda visual de las capas del mapa.
 * Permite toggle on/off de cada capa con su dot de color.
 */
export function MapLegend({ layers, onToggle, ariaLabel = "Leyenda del mapa" }: MapLegendProps) {
  return (
    <section
      aria-label={ariaLabel}
      className="flex items-center gap-4 rounded-xl border border-[#d2ddd6] bg-white px-4 py-2 shadow-lg"
    >
      {LAYERS.map((entry) => (
        <label
          className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase text-[#4a5b50]"
          key={entry.key}
        >
          <input
            checked={layers[entry.key]}
            className="h-3.5 w-3.5 cursor-pointer rounded text-[#0b5f2d] focus:ring-[#0b5f2d]"
            onChange={() => onToggle(entry.key)}
            type="checkbox"
          />
          <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.label}</span>
        </label>
      ))}
    </section>
  );
}
