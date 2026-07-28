"use client";

// components/parcels/parcel-map.tsx
//
// ParcelMap — v0.1 (port del V0 a nuestro proyecto).
//
// Sprint v0.1 — port de `docs/fumigation-management-dashboard/components/parcels/parcel-map.tsx`.
// Adaptaciones al proyecto actual:
//   - Esri imagery (World_Imagery) — satelital, igual que el V0. El
//     `parcel-mini-map.tsx` sigue usando OSM (calles, más liviano) porque
//     es para vista agregada del portafolio. Acá, donde el operador quiere
//     VER la parcela (geometría, vuelos, linderos), el satelital es más
//     útil que el plano de calles.
//   - `geom: GeoJSON.Geometry | null` (más amplio que el V0 que era
//     `{ type: "Polygon"; coordinates: [...] }`). Soportamos Polygon y
//     MultiPolygon (los únicos tipos válidos para una parcela). Otros
//     tipos se ignoran gracefully (fitBounds no corre, el polígono no
//     se dibuja, pero NO rompe).
//   - `dynamic({ ssr: false })` aplicado al default export. Esto permite
//     importarlo desde server components (`app/parcels/[id]/page.tsx`)
//     sin que el bundle del cliente reciba `maplibre-gl` en SSR. El
//     named export (`ParcelMap`) es el inner component, testeable en
//     vitest sin necesidad del wrapper dynamic.
//   - "No interactions excepto zoom limitado": dragPan OFF, dragRotate OFF,
//     touchZoomRotate OFF, keyboard OFF, boxZoom OFF. SOLO scroll zoom y
//     double-click zoom, con minZoom=10 y maxZoom=18. Más restrictivo que
//     `ParcelMiniMap` (que es interactivo) — el V0 le pasaba
//     `interactive: true` y el control era muy laxo.
//   - Flights: el V0 dibujaba cada flight con un offset random (para
//     "jitter" visual cuando había varios en la misma parcela). Acá
//     mantenemos ese patrón (es lo que ve el operador: agrupados pero
//     distinguibles). El color es amarillo fijo (consistente con
//     `MapLibreView` que también usa amarillo para flights).
//
// Por qué dos exports (named + default):
//   - Tests importan el named (`ParcelMap`) para poder mockear maplibre-gl
//     y verificar las llamadas (addSource, addLayer, fitBounds, etc).
//   - Páginas importan el default (`ParcelMapClient`) que es la versión
//     `dynamic({ ssr: false })` — funciona desde server components.
//
// Estilo: border + rounded-lg + height h-64 en mobile, h-80 en sm+.

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection } from "geojson";
import type { Map as MlMap } from "maplibre-gl";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

// =====================================================================
// Tipos públicos
// =====================================================================

export interface ParcelMapFlight {
  id: number | string;
  lng: number;
  lat: number;
  /** Nombre del piloto, opcional (se muestra en el tooltip del marker). */
  pilot?: string;
}

export interface ParcelMapProps {
  /**
   * Geometría de la parcela (Polygon o MultiPolygon). Si es null o un
   * tipo no soportado, el mapa renderiza centrado en Valle del Cauca
   * sin polígono (modo fallback).
   */
  geom: GeoJSON.Geometry | null;
  /** Color hex del polígono (fill + line). Lo decide el caller según estado. */
  color: string;
  /** Vuelos asociados a la parcela (se dibujan como circle markers). */
  flights: ParcelMapFlight[];
}

// =====================================================================
// Constantes internas
// =====================================================================

const STREETS_STYLE: import("maplibre-gl").StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    esri: {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery &copy; Esri, Maxar"
    }
  },
  layers: [{ id: "esri-base", type: "raster", source: "esri" }]
};

const FALLBACK_CENTER: [number, number] = [-76.532, 3.4516]; // Valle del Cauca
const FALLBACK_ZOOM = 14;
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

// =====================================================================
// Helpers de geometría
// =====================================================================

/**
 * Extrae las coordenadas extremas de un Polygon o MultiPolygon para
 * fitBounds. Devuelve `null` si el input no es un polígono válido.
 *
 * Importante: el V0 asumía Polygon. Acá soportamos MultiPolygon también
 * (algunas parcelas del dataset real son MultiPolygon — la geometría
 * tiene un hueco interior o está partida por un camino).
 */
function getBoundsFromGeometry(geom: GeoJSON.Geometry): [[number, number], [number, number]] | null {
  const coords: [number, number][] = [];

  function pushRing(ring: number[][]) {
    for (const c of ring) {
      if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") {
        coords.push([c[0], c[1]]);
      }
    }
  }

  if (geom.type === "Polygon") {
    for (const ring of geom.coordinates) pushRing(ring);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates) {
      for (const ring of poly) pushRing(ring);
    }
  } else {
    return null;
  }

  if (coords.length === 0) return null;
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
  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

/**
 * Construye el FeatureCollection de la parcela para la fuente `parcel`.
 * Devuelve solo el feature del polígono (los flights van en su propia
 * source `flights` para tener su propio layer).
 */
function buildParcelFeature(geom: GeoJSON.Geometry | null): Feature | null {
  if (!geom) return null;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return null;
  return { type: "Feature", properties: {}, geometry: geom };
}

/**
 * Construye el FeatureCollection de flights con un "jitter" determinístico
 * para que cuando hay varios vuelos en el mismo punto se vean separados
 * (mismo patrón que el V0). El jitter es ~10-50 m (1e-4 grados ≈ 11m).
 */
function buildFlightsCollection(flights: ParcelMapFlight[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: flights.map((f, i) => {
      const a = (i % 14) * ((Math.PI * 2) / 14);
      const r = 0.0004 + (i % 5) * 0.00018;
      return {
        type: "Feature",
        properties: { pilot: f.pilot ?? null, id: String(f.id) },
        geometry: {
          type: "Point",
          coordinates: [f.lng + Math.cos(a) * r, f.lat + Math.sin(a) * r]
        }
      };
    })
  };
}

// =====================================================================
// Componente interno (testable)
// =====================================================================

function ParcelMapInner({ geom, color, flights }: ParcelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;

    async function init() {
      const mod = await import("maplibre-gl");
      const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
      if (cancelled || !containerRef.current) return;

      const bounds = getBoundsFromGeometry(geom ?? { type: "Point", coordinates: FALLBACK_CENTER });

      const mapOptions: ConstructorParameters<typeof maplibregl.Map>[0] = {
        container: containerRef.current,
        style: STREETS_STYLE,
        // Interacciones: SOLO zoom limitado. El resto OFF para que el
        // usuario no pueda "perderse" arrastrando el mapa. Decisión de
        // producto: el mini-mapa es informativo, no interactivo para
        // navegación libre.
        interactive: true,
        scrollZoom: true,
        boxZoom: false,
        dragPan: false,
        dragRotate: false,
        keyboard: false,
        doubleClickZoom: true,
        touchPitch: false,
        touchZoomRotate: false,
        attributionControl: { compact: true },
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM
      };

      if (bounds) {
        // Pasamos `bounds` al constructor para que MapLibre haga el
        // initial fit. Pero también lo guardamos para hacer un `fitBounds`
        // EXPLÍCITO en el load handler — más testeable y consistente
        // con `ParcelMiniMap`. Si el `bounds` del constructor ya
        // posicionó el mapa, este fitBounds es esencialmente un no-op
        // (idénticos bounds), así que es idempotente.
        mapOptions.bounds = bounds;
        mapOptions.fitBoundsOptions = { padding: 34 };
      } else {
        mapOptions.center = FALLBACK_CENTER;
        mapOptions.zoom = FALLBACK_ZOOM;
      }

      map = new maplibregl.Map(mapOptions);
      const initialBounds = bounds;

      // Navigation control (V0 1:1). Compass off — el mini-mapa es
      // informativo, no un navegador interactivo completo.
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        const m = map;
        if (!m) return;

        // Source + layers del polígono
        const parcelFeature = buildParcelFeature(geom);
        if (parcelFeature) {
          m.addSource("parcel", { type: "geojson", data: parcelFeature });
          m.addLayer({
            id: "parcel-fill",
            type: "fill",
            source: "parcel",
            paint: { "fill-color": color, "fill-opacity": 0.35 }
          });
          m.addLayer({
            id: "parcel-line",
            type: "line",
            source: "parcel",
            paint: { "line-color": color, "line-width": 2.4 }
          });
        }

        // Source + layer de flights
        m.addSource("flights", {
          type: "geojson",
          data: buildFlightsCollection(flights)
        });
        m.addLayer({
          id: "flights-circle",
          type: "circle",
          source: "flights",
          paint: {
            "circle-radius": 3.6,
            "circle-color": "#f5e839",
            "circle-opacity": 0.9,
            "circle-stroke-color": "rgba(32,33,37,0.7)",
            "circle-stroke-width": 0.6
          }
        });

        // FitBounds EXPLÍCITO (consistente con ParcelMiniMap, más testeable
        // y safe contra crashes en geometrías extrañas).
        if (initialBounds) {
          try {
            m.fitBounds(initialBounds, { padding: 34, maxZoom: MAX_ZOOM, duration: 0 });
          } catch {
            /* ignore — fitBounds puede tirar con bounds inválidos */
          }
        }

        setReady(true);
      });
    }

    init();
    return () => {
      cancelled = true;
      map?.remove();
      setReady(false);
    };
  }, [geom, color, flights]);

  return (
    <div
      className="relative h-64 overflow-hidden rounded-lg border border-border sm:h-80"
      data-slot="parcel-map"
      data-testid="parcel-map"
    >
      <div
        ref={containerRef}
        aria-label="Geometría de la parcela"
        className="size-full"
        role="application"
      />
      {!ready ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-muted"
          data-testid="parcel-map-loading"
        >
          <span className="font-mono text-xs text-muted-foreground">Cargando geometría…</span>
        </div>
      ) : null}
    </div>
  );
}

// =====================================================================
// Exports públicos
// =====================================================================

/** Componente testable (named export). Usar desde otros client components. */
export const ParcelMap = ParcelMapInner;

/**
 * Versión `dynamic({ ssr: false })` para usar desde server pages.
 * Evita que el bundle de `maplibre-gl` se incluya en el SSR. Si la página
 * es server (e.g. `app/parcels/[id]/page.tsx`), importar el default
 * (`import ParcelMap from "@/components/parcels/parcel-map"`).
 */
const ParcelMapClient = dynamic(
  () => Promise.resolve(ParcelMapInner),
  {
    ssr: false,
    loading: () => (
      <div
        className="relative h-64 overflow-hidden rounded-lg border border-border bg-muted sm:h-80"
        data-slot="parcel-map"
        data-testid="parcel-map-skeleton"
      >
        <div className="grid size-full place-items-center">
          <span className="font-mono text-xs text-muted-foreground">Cargando mapa…</span>
        </div>
      </div>
    )
  }
);
export default ParcelMapClient;
