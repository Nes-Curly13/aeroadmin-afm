"use client";

/**
 * ParcelMiniMap — v2.0 (sprint S5) — migración Leaflet → MapLibre.
 *
 * Mini-mapa de UNA sola parcela usado en /parcels/[id].
 * Muestra:
 *   - Polígono de la spray zone (verde brand / amarillo orchard).
 *   - Waypoints del plan de vuelo (circles dorados).
 *   - Home point (punto rojo).
 *   - FitBounds automático al polígono (maxZoom 18).
 *
 * Diferencias con `MapLibreView`:
 *   - No tiene basemap toggle ni controls UI (es solo un thumbnail).
 *   - No tiene layers toggles (siempre muestra todo).
 *   - Style inline `streets` (no se persiste, no se cambia).
 *   - Sin popups (es un preview, no interactivo).
 *
 * Patron del V0: el mockup no tiene mini-mapa; el patron es propio
 * del proyecto actual, portado a MapLibre.
 */

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection } from "geojson";
import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { DjiParcelRecord } from "@/lib/types";

const STREETS_STYLE: import("maplibre-gl").StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm-base", type: "raster", source: "osm" }]
};

function buildCollection(parcel: DjiParcelRecord) {
  const features: Feature[] = [];
  if (parcel.spray_geometry) {
    features.push({
      type: "Feature",
      properties: { kind: "spray" },
      geometry: parcel.spray_geometry
    });
  }
  if (parcel.waypoints_geometry) {
    const g = parcel.waypoints_geometry;
    if (g.type === "MultiPoint") {
      (g.coordinates as number[][]).forEach((coord, idx) => {
        features.push({
          type: "Feature",
          properties: { kind: "waypoint", index: idx },
          geometry: { type: "Point", coordinates: coord }
        });
      });
    } else if (g.type === "Point") {
      features.push({
        type: "Feature",
        properties: { kind: "waypoint", index: 0 },
        geometry: g
      });
    }
  }
  if (parcel.reference_point?.type === "Point") {
    features.push({
      type: "Feature",
      properties: { kind: "home" },
      geometry: parcel.reference_point
    });
  }
  return { type: "FeatureCollection" as const, features };
}

export function ParcelMiniMap({ parcel }: { parcel: DjiParcelRecord }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);

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
        center: [-76.532, 3.4516],
        zoom: 16,
        interactive: true,
        attributionControl: { compact: true }
      });
      mapRef.current = map;

      map.on("load", () => {
        const m = map;
        if (!m) return;
        const collection = buildCollection(parcel);
        m.addSource("parcel", { type: "geojson", data: collection });
        m.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel",
          filter: ["==", ["get", "kind"], "spray"],
          paint: {
            "fill-color": parcel.is_orchard ? "#f4a460" : "#90EE90",
            "fill-opacity": 0.4
          }
        });
        m.addLayer({
          id: "parcel-line",
          type: "line",
          source: "parcel",
          filter: ["==", ["get", "kind"], "spray"],
          paint: {
            "line-color": parcel.is_orchard ? "#7b3f00" : "#0b5f2d",
            "line-width": 2
          }
        });
        m.addLayer({
          id: "parcel-waypoints",
          type: "circle",
          source: "parcel",
          filter: ["==", ["get", "kind"], "waypoint"],
          paint: {
            "circle-radius": 3,
            "circle-color": "#c7a43a",
            "circle-stroke-color": "#5a4a1e",
            "circle-stroke-width": 1,
            "circle-opacity": 0.9
          }
        });
        m.addLayer({
          id: "parcel-home",
          type: "circle",
          source: "parcel",
          filter: ["==", ["get", "kind"], "home"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#ba1a1a",
            "circle-stroke-color": "#5a0000",
            "circle-stroke-width": 2
          }
        });

        // FitBounds al polígono
        const coords: [number, number][] = [];
        const g = parcel.spray_geometry;
        if (g) {
          if (g.type === "Polygon") {
            for (const ring of g.coordinates) {
              for (const [lng, lat] of ring as number[][]) coords.push([lng, lat]);
            }
          } else if (g.type === "MultiPolygon") {
            for (const poly of g.coordinates) {
              for (const ring of poly) {
                for (const [lng, lat] of ring as number[][]) coords.push([lng, lat]);
              }
            }
          }
        }
        if (coords.length > 0) {
          let minLng = coords[0][0];
          let minLat = coords[0][1];
          let maxLng = coords[0][0];
          let maxLat = coords[0][1];
          for (const [lng, lat] of coords) {
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
          }
          try {
            m.fitBounds(
              [
                [minLng, minLat],
                [maxLng, maxLat]
              ],
              { padding: 50, maxZoom: 18, duration: 0 }
            );
          } catch {
            /* ignore */
          }
        }
      });
    }

    init();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [parcel]);

  return (
    <div
      className="h-[280px] w-full overflow-hidden rounded-lg border border-border"
      data-testid="parcel-mini-map"
    >
      <div
        ref={containerRef}
        aria-label={`Mapa de la parcela ${parcel.land_name ?? parcel.id}`}
        className="size-full"
        role="application"
        tabIndex={0}
      />
    </div>
  );
}
