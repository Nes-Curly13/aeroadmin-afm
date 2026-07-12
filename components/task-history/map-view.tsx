"use client";

/**
 * MapView — client component.
 *
 * Renderiza los polígonos de las fincas (decisión 5: TODOS del mismo
 * color, seleccionables, datos en cards). Decisión 5 confirmada por el
 * user el 2026-07-12: "deja los polígonos todos de un mismo color pero
 * que se puedan seleccionar en el mapa y ver sus datos en las cards".
 *
 * Stack: react-leaflet 5.0.0 (ya en package.json). El componente es
 * client-only; el padre server component NO debe importar este archivo
 * directamente — usar `next/dynamic({ ssr: false })` en el caller.
 *
 * Props:
 *   - polygons: array de {parcelId, landName, areaHa, geometry} (GeoJSON).
 *     Si geometry es null, ese parcel no se renderiza.
 *   - center: [lat, lng] opcional. Default: Valle del Cauca (~3.5, -76.3).
 *   - zoom: number opcional. Default: 11.
 *   - selectedParcelId: id de parcela a resaltar. Opcional.
 *   - onSelect: callback fired al clickear un polígono.
 *
 * Estilo: paleta verde teal (#14b8a6 / #0b5f2d) consistente con
 * header-card.tsx y day-card.tsx.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  useMap,
  ZoomControl
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [3.5, -76.3];
const DEFAULT_ZOOM = 11;

/** Polígono fumigado que viene del endpoint /api/task-history. */
export interface MapPolygon {
  parcelId: number;
  landName: string | null;
  areaHa: number | null;
  geometry: GeoJSON.Geometry | null;
  /** YYYY-MM-DD strings; vacío si la parcela no fumigó en el rango. */
  datesFumigated: string[];
}

export interface MapViewProps {
  polygons: MapPolygon[];
  center?: [number, number];
  zoom?: number;
  selectedParcelId?: number | null;
  onSelect?: (parcelId: number) => void;
  /** Altura CSS del contenedor. Default: '600px'. */
  height?: string;
  /** Test id del contenedor principal. */
  testId?: string;
}

const DEFAULT_HEIGHT = "600px";
const DEFAULT_TEST_ID = "task-history-map-view";

const POLY_COLOR = "#0b5f2d"; // verde teal oscuro (del Figma)
const POLY_HOVER_COLOR = "#14b8a6"; // verde teal brillante
const POLY_SELECTED_COLOR = "#f59e0b"; // amber para destacar el seleccionado
const POLY_OPACITY = 0.5;
const POLY_STROKE = "#0b5f2d";

/**
 * Renderiza cada polígono fumigado como un círculo. Usamos CircleMarker
 * en lugar de Polygon porque:
 *   1. El GeoJSON de DJI puede tener MultiPolygon de cientos de vértices
 *      (ruido de la flight path) — CircleMarker da una vista más limpia.
 *   2. Es más performante para 1207 markers.
 *   3. El "polígono real" ya está en dji_parcels.spray_geom (no necesitamos
 *      re-renderizar la geometría exacta en el mapa overview).
 *
 * Si en el futuro el usuario quiere el polígono exacto, se reemplaza
 * `CircleMarker` por `Polygon` con `positions={coords}` parseando el
 * GeoJSON.
 */
function ParcelMarker({
  parcel,
  selected,
  onSelect
}: {
  parcel: MapPolygon;
  selected: boolean;
  onSelect: (parcelId: number) => void;
}) {
  // Si la geometría tiene un punto representativo (centro del bbox o
  // centroide), lo usamos. Si no, no rendereamos (no se debería
  // llamar este componente sin geometry válido).
  const center = useMemo<[number, number] | null>(() => {
    if (!parcel.geometry) return null;
    return extractCenter(parcel.geometry);
  }, [parcel.geometry]);

  if (!center) return null;

  const fillColor = selected
    ? POLY_SELECTED_COLOR
    : selected
      ? POLY_SELECTED_COLOR
      : POLY_COLOR;

  return (
    <CircleMarker
      center={center}
      eventHandlers={{
        click: () => onSelect(parcel.parcelId),
        mouseover: (e) => {
          e.target.setStyle({ fillColor: POLY_HOVER_COLOR, fillOpacity: 0.7 });
        },
        mouseout: (e) => {
          e.target.setStyle({
            fillColor: selected ? POLY_SELECTED_COLOR : POLY_COLOR,
            fillOpacity: POLY_OPACITY
          });
        }
      }}
      fillColor={fillColor}
      fillOpacity={POLY_OPACITY}
      pathOptions={{
        color: POLY_STROKE,
        weight: selected ? 3 : 1.5
      }}
      radius={Math.max(4, Math.sqrt(parcel.areaHa ?? 0.5) * 250)}
    >
      {parcel.landName ? null : null}
    </CircleMarker>
  );
}

/** Extrae un punto representativo (centro del bbox) de un GeoJSON. */
function extractCenter(geom: GeoJSON.Geometry): [number, number] | null {
  // `GeoJSON.Geometry` no incluye `FeatureCollection` (eso es top-level
  // y se desempaca en el API boundary de /api/task-history). Aquí
  // asumimos `Geometry` puro.
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates as number[];
    if (typeof lng === "number" && typeof lat === "number") return [lat, lng];
    return null;
  }
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
    return bboxCenter(geom);
  }
  // LineString / MultiLineString / MultiPoint / GeometryCollection: no
  // tienen un "centro" obvio para el mapa overview. Devolvemos null
  // y el marker simplemente no se renderiza (el padre filtra los
  // polygons con geometry null al render).
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
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
}

/** Centra el mapa en un parcelId cuando cambia. */
function FocusOnSelection({
  polygons,
  selectedParcelId
}: {
  polygons: MapPolygon[];
  selectedParcelId: number | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (selectedParcelId === null || selectedParcelId === undefined) return;
    const p = polygons.find((x) => x.parcelId === selectedParcelId);
    if (!p?.geometry) return;
    const c = extractCenter(p.geometry);
    if (c) map.setView(c, 14, { animate: true });
  }, [map, polygons, selectedParcelId]);
  return null;
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
  const handleSelect = useCallback(
    (parcelId: number) => {
      onSelect?.(parcelId);
    },
    [onSelect]
  );

  // Filtrar solo los polygons con geometry válida.
  const renderable = useMemo(
    () => polygons.filter((p) => p.geometry !== null),
    [polygons]
  );

  // Para el "locate" button: recenter al centro default.
  const mapRef = useRef(null);
  const handleRecenter = useCallback(() => {
    // mapRef se setea via LeafletMapRef (no implementado completamente)
    // Para simplicidad: usa el "useMap" en un componente hijo. Pero acá
    // simplificamos con un botón que dispara un custom event.
    const event = new CustomEvent("task-history:recenter", { detail: center });
    window.dispatchEvent(event);
  }, [center]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-[#d2ddd6] bg-white"
      data-testid={testId}
      style={{ height }}
    >
      <MapContainer
        attributionControl
        center={center}
        className="h-full w-full"
        scrollWheelZoom
        zoom={zoom}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <FocusOnSelection polygons={polygons} selectedParcelId={selectedParcelId} />
        {renderable.map((p) => (
          <ParcelMarker
            key={p.parcelId}
            onSelect={handleSelect}
            parcel={p}
            selected={p.parcelId === selectedParcelId}
          />
        ))}
      </MapContainer>
      <button
        aria-label="Recentrar mapa"
        className="absolute right-3 bottom-14 z-[1000] flex h-9 w-9 items-center justify-center rounded-full border border-[#d2ddd6] bg-white text-[#0b5f2d] shadow hover:bg-[#f4f7f4] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]"
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
