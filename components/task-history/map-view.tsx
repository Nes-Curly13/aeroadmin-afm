"use client";

/**
 * TaskHistoryMapView — client component (v2.0 sprint S5 — Leaflet → MapLibre).
 *
 * Renderiza los polígonos de las fincas (decisión 5: TODOS del mismo
 * color, seleccionables, datos en cards).
 *
 * Stack: MapLibre GL JS 6.0 (sustituye react-leaflet 5.0 eliminado en v2.0).
 * El componente es client-only; el padre server component NO debe
 * importar este archivo directamente — usar `next/dynamic({ ssr: false })`.
 *
 * Props: ver interface MapViewProps abajo. Mismo contrato que la versión
 * Leaflet previa (sin breaking changes para callers).
 *
 * Estilo: paleta verde teal (#0b5f2d / #14b8a6) consistente con
 * header-card.tsx y day-card.tsx.
 */

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MlMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef } from "react";

const DEFAULT_CENTER: [number, number] = [-76.3, 3.5]; // [lng, lat] MapLibre
const DEFAULT_ZOOM = 11;

/** Polígono fumigado que viene del endpoint /api/task-history. */
export interface MapPolygon {
  parcelId: number;
  landName: string | null;
  areaHa: number | null;
  geometry: GeoJSON.Geometry | null;
  datesFumigated: string[];
}

export interface MapViewProps {
  polygons: MapPolygon[];
  center?: [number, number];
  zoom?: number;
  selectedParcelId?: number | null;
  onSelect?: (parcelId: number) => void;
  height?: string;
  testId?: string;
}

const DEFAULT_HEIGHT = "600px";
const DEFAULT_TEST_ID = "task-history-map-view";

const POLY_COLOR = "#0b5f2d";
const POLY_HOVER_COLOR = "#14b8a6";
const POLY_SELECTED_COLOR = "#f59e0b";
const POLY_OPACITY = 0.5;
const POLY_STROKE = "#0b5f2d";

const STREETS_STYLE: import("maplibre-gl").StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "&copy; OpenStreetMap"
    }
  },
  layers: [{ id: "osm-base", type: "raster", source: "osm" }]
};

function extractCenter(geom: GeoJSON.Geometry): [number, number] | null {
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates as number[];
    if (typeof lng === "number" && typeof lat === "number") return [lng, lat];
    return null;
  }
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return bboxCenter(geom);
  }
  return null;
}

function bboxCenter(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const rings = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

export function MapView({
  polygons,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  selectedParcelId = null,
  onSelect,
  height = DEFAULT_HEIGHT,
  testId = DEFAULT_TEST_ID
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Filtrar polygons con geometry válida.
  const renderable = useMemo(
    () => polygons.filter((p) => p.geometry !== null),
    [polygons]
  );

  // Init del mapa.
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;

    async function init() {
      const mod = await import("maplibre-gl");
      const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: STREETS_STYLE,
        center,
        zoom,
        attributionControl: { compact: true }
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

      map.on("load", () => {
        const m = map;
        if (!m) return;
        m.addSource("task-history-parcels", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] }
        });
        m.addLayer({
          id: "task-history-circles",
          type: "circle",
          source: "task-history-parcels",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9, 4,
              13, 8,
              16, 14
            ],
            "circle-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              POLY_SELECTED_COLOR,
              POLY_COLOR
            ],
            "circle-opacity": POLY_OPACITY,
            "circle-stroke-color": POLY_STROKE,
            "circle-stroke-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              3,
              1.5
            ]
          }
        });

        m.on("click", "task-history-circles", (e) => {
          const id = e.features?.[0]?.properties?.parcelId as number | undefined;
          if (id !== undefined) onSelectRef.current?.(id);
        });
        m.on("mouseenter", "task-history-circles", () => {
          if (m) m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", "task-history-circles", () => {
          if (m) m.getCanvas().style.cursor = "";
        });
      });
    }

    init();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("task-history-parcels") as { setData?: (d: unknown) => void } | undefined;
      if (!src?.setData) return;
      const features = renderable.map((p) => {
        const c = extractCenter(p.geometry!);
        return {
          type: "Feature" as const,
          id: p.parcelId,
          properties: {
            parcelId: p.parcelId,
            landName: p.landName ?? "",
            areaHa: p.areaHa ?? 0
          },
          geometry: {
            type: "Point" as const,
            coordinates: c ?? [0, 0]
          }
        };
      });
      src.setData({ type: "FeatureCollection", features });
    };
    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [renderable]);

  // Selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.removeFeatureState({ source: "task-history-parcels" });
    if (selectedParcelId === null) return;
    map.setFeatureState(
      { source: "task-history-parcels", id: selectedParcelId },
      { selected: true }
    );
    const p = polygons.find((x) => x.parcelId === selectedParcelId);
    if (p?.geometry) {
      const c = extractCenter(p.geometry);
      if (c) map.flyTo({ center: c, zoom: 14, duration: 900 });
    }
  }, [selectedParcelId, polygons]);

  const handleRecenter = useCallback(() => {
    mapRef.current?.flyTo({ center, zoom, duration: 600 });
  }, [center, zoom]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white"
      data-testid={testId}
      style={{ height }}
    >
      <div
        ref={containerRef}
        aria-label="Mapa de historial de fumigaciones"
        className="size-full"
        role="application"
        tabIndex={0}
      />
      <button
        aria-label="Recentrar mapa"
        className="absolute right-3 bottom-14 z-[1000] flex h-9 w-9 items-center justify-center rounded-full border border-[#d2ddd6] bg-white text-[#0b5f2d] shadow hover:bg-[#f4f7f4] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]"
        data-testid="task-history-map-recenter"
        onClick={handleRecenter}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          viewBox="0 0 16 16"
        >
          <circle cx="8" cy="8" r="3" />
          <line x1="8" x2="8" y1="1" y2="4" />
          <line x1="8" x2="8" y1="12" y2="15" />
          <line x1="1" x2="4" y1="8" y2="8" />
          <line x1="12" x2="15" y1="8" y2="8" />
        </svg>
      </button>
    </div>
  );
}

export default MapView;
