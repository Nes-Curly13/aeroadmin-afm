"use client";

/**
 * ParcelMapPicker — elige una parcela clickeando su polígono en el mapa.
 *
 * Complementa la búsqueda por texto del wizard de fumigaciones: cuando
 * el operador no sabe el nombre pero sí la ubicación, la elige en el
 * mapa. Reutiliza `GET /api/admin/parcels/geojson` (parcelas por
 * viewport) y devuelve un `ParcelPickerRow` con el mismo shape que el
 * picker por texto, para que el wizard la trate igual.
 *
 * Basemap: MapTiler satellite si hay NEXT_PUBLIC_MAPTILER_KEY, si no
 * EOX Sentinel-2 (mismo criterio que el ParcelDrawer).
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, {
  Map as MlMap,
  type StyleSpecification
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParcelPickerRow } from "@/api/repositories";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const USE_MAPTILER = MAPTILER_KEY.length > 0;

const EOX_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    eox: {
      type: "raster",
      tiles: [EOX_TILE_URL],
      tileSize: 256,
      maxzoom: 14,
      attribution: "Sentinel-2 cloudless 2024 © EOX"
    }
  },
  layers: [{ id: "eox", type: "raster", source: "eox" }]
};

const SRC = "fm-parcels";
const FILL = "fm-parcels-fill";
const LINE = "fm-parcels-line";
const SELECTED = "fm-parcels-selected";

/** Defaults ESTABLES (misma referencia entre renders) — si no, el
 *  effect de init del mapa se re-corre en cada render. */
const DEFAULT_CENTER: [number, number] = [-76.31, 3.45];
const DEFAULT_ZOOM = 12;

export interface ParcelMapPickerProps {
  onPick: (row: ParcelPickerRow) => void;
  /** Parcela seleccionada (se resalta). */
  selectedId?: number | null;
  /** Alto del mapa (Tailwind). Default h-[320px]. */
  className?: string;
  initialCenter?: [number, number];
  initialZoom?: number;
}

function Overlay({
  children,
  tone = "muted"
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] shadow-[0_-6px_12px_-8px_rgba(0,0,0,0.3)]",
        tone === "warn"
          ? "bg-amber-50/95 text-amber-900"
          : "bg-card/95 text-muted-foreground"
      )}
    >
      {children}
    </div>
  );
}

export function ParcelMapPicker({
  onPick,
  selectedId = null,
  className,
  initialCenter = DEFAULT_CENTER,
  initialZoom = DEFAULT_ZOOM
}: ParcelMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onPickRef = useRef(onPick);
  const selectedIdRef = useRef<number | null>(selectedId);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading"
  );

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    const map = mapRef.current;
    if (map && map.getLayer(SELECTED)) {
      map.setFilter(SELECTED, ["==", ["get", "id"], selectedId ?? -1]);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: USE_MAPTILER
        ? `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`
        : FALLBACK_STYLE,
      center: initialCenter,
      zoom: initialZoom
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );

    map.on("load", () => {
      map.addSource(SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.addLayer({
        id: FILL,
        type: "fill",
        source: SRC,
        paint: { "fill-color": "#16a34a", "fill-opacity": 0.08 }
      });
      map.addLayer({
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": "#15803d",
          "line-width": 1.2,
          "line-opacity": 0.85
        }
      });
      map.addLayer({
        id: SELECTED,
        type: "line",
        source: SRC,
        paint: { "line-color": "#f59e0b", "line-width": 3 },
        filter: ["==", ["get", "id"], selectedIdRef.current ?? -1]
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      const refresh = async () => {
        const b = map.getBounds();
        try {
          const res = await fetch(
            `/api/admin/parcels/geojson?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&limit=500`
          );
          if (!res.ok) {
            setStatus("error");
            return;
          }
          const fc = (await res.json()) as {
            features?: unknown[];
          };
          const src = map.getSource(SRC) as
            | maplibregl.GeoJSONSource
            | undefined;
          src?.setData(fc as unknown as GeoJSON.FeatureCollection);
          setStatus((fc.features?.length ?? 0) === 0 ? "empty" : "ready");
        } catch {
          setStatus("error");
        }
      };
      void refresh();
      map.on("moveend", () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 350);
      });

      map.on("click", FILL, (e) => {
        const p = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
        if (p.id == null) return;
        onPickRef.current({
          id: Number(p.id),
          land_name: (p.land_name as string | null) ?? null,
          external_id: (p.external_id as string | null) ?? "",
          source: (p.source as string | null) ?? null,
          client_name: (p.client_name as string | null) ?? null,
          farm_name: (p.farm_name as string | null) ?? null,
          municipality: (p.municipality as string | null) ?? null
        });
      });
      map.on("mouseenter", FILL, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", FILL, () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [initialCenter, initialZoom]);

  return (
    <div
      className={cn(
        "relative h-[320px] w-full overflow-hidden rounded-lg border border-input",
        className
      )}
      data-testid="parcel-map-picker"
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid="parcel-map-picker-map"
        role="application"
        aria-label="Mapa para elegir la parcela"
      />
      {status === "loading" ? (
        <Overlay>
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Cargando parcelas…
        </Overlay>
      ) : status === "empty" ? (
        <Overlay>
          <MapPin className="size-3" aria-hidden />
          No hay parcelas en esta zona. Movés el mapa o buscá por nombre
          arriba.
        </Overlay>
      ) : status === "error" ? (
        <Overlay tone="warn">
          <AlertTriangle className="size-3" aria-hidden />
          No se pudieron cargar las parcelas. Probá de nuevo.
        </Overlay>
      ) : (
        <Overlay>
          <MapPin className="size-3" aria-hidden />
          Toca una parcela para elegirla.
        </Overlay>
      )}
    </div>
  );
}
