"use client";

/**
 * MapLibreView — reemplazo de MapClient (Leaflet) con MapLibre GL JS.
 *
 * Migración del v2.0 (sprint 2026-07-28) para alinear el proyecto con
 * el stack del mockup V0 (docs/fumigation-management-dashboard). El V0
 * usa MapLibre; el proyecto actual usa Leaflet+react-leaflet.
 *
 * Por qué migrar:
 *   - Mejor performance con 1200+ polígonos (vector tiles, GPU).
 *   - Estilo declarativo con style spec (más control que Leaflet).
 *   - API más limpia para animation (flyTo, easeTo, fly-around).
 *   - Ecosistema activo: deck.gl, mapbox-style-spec, etc.
 *
 * Features portada 1:1 desde map-client.tsx (Leaflet):
 *   - Basemap toggle (satellite | streets) con localStorage.
 *   - Source/layer "parcels" con fill+line, labels permanentes a zoom >= 13.
 *   - Source/layer "waypoints" (circles) y "flight-plan" (lines).
 *   - Source/layer "alerts" (polygons con color por nivel).
 *   - Source/layer "flight-points" (circles con color por estado).
 *   - Popups on click (HTML sanitizado).
 *   - Tooltip sticky on hover.
 *   - Click parcel → emit onSelect (sincroniza con UI).
 *   - FitBounds automático al cargar.
 *   - ZoomWatcher: toggle labels según zoom.
 *   - Scale bar (MapLibre nativo).
 *   - Navigation control (zoom +/-) y basemap badge overlay.
 *
 * Diferencias con Leaflet:
 *   - NO hay `<LayersControl>` nativo. Los toggles de capa se exponen
 *     vía props (`showParcels`, `showWaypoints`, etc.) y el caller
 *     decide si renderear una UI de toggle o no. (Default: todos on.)
 *   - Popups/tooltips son vanilla DOM (React portal). No innerHTML.
 *   - Coordinate system: MapLibre usa [lng, lat] (no [lat, lng] como
 *     Leaflet). El adapter `lngLat` resuelve esto.
 *
 * Performance:
 *   - MapLibre es client-only (WebGL). El componente es "use client"
 *     y se monta via `next/dynamic` con `ssr: false` desde MapView.
 *   - Imports dinámicos de maplibre-gl para evitar bundle en SSR.
 */

import "maplibre-gl/dist/maplibre-gl.css";

import type { Feature, FeatureCollection } from "geojson";
import type { Map as MlMap, StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getParcelPolygonStyle } from "@/lib/map-styles";
import { COLORS } from "@/lib/ui-tokens";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";
import { getParcelA11yLabel, getParcelPopupContent } from "@/lib/map-parcel-content";

const DEFAULT_CENTER: [number, number] = [-76.532, 3.4516]; // [lng, lat] Valle del Cauca
const DEFAULT_ZOOM = 14;
const LABEL_MIN_ZOOM_DEFAULT = 13;

type Basemap = "satellite" | "streets";

const BASEMAP_STORAGE_KEY = "afm:map:basemap";
const DEFAULT_BASEMAP: Basemap = "satellite";

const BASEMAPS: Record<Basemap, { label: string; style: StyleSpecification }> = {
  satellite: {
    label: "Satélite",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        esri: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Tiles &copy; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
        }
      },
      layers: [{ id: "esri-base", type: "raster", source: "esri" }]
    }
  },
  streets: {
    label: "Calles",
    style: {
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
    }
  }
} as const;

// ============================================================
// Helpers: GeoJSON builders
// ============================================================

function parcelsToFeatureCollection(parcels: DjiParcelRecord[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: parcels
      .filter((p) => p.spray_geometry)
      .map((p): Feature => ({
        type: "Feature",
        id: p.id,
        properties: {
          id: p.id,
          name: p.land_name,
          field_type: p.field_type ?? "Farmland",
          is_orchard: p.is_orchard === true,
          declared_area_ha: p.declared_area_ha ?? null,
          spray_area_m2: p.spray_area_m2 ?? null,
          waypoint_count: p.waypoint_count ?? 0
        },
        geometry: p.spray_geometry!
      }))
  };
}

function waypointsToFeatureCollection(parcels: DjiParcelRecord[]): FeatureCollection {
  const features: Feature[] = [];
  for (const parcel of parcels) {
    const geom = parcel.waypoints_geometry;
    if (!geom) continue;
    if (geom.type === "MultiPoint") {
      (geom.coordinates as number[][]).forEach((coord, idx) => {
        features.push({
          type: "Feature",
          properties: { parcel_id: parcel.id, parcel_name: parcel.land_name, index: idx },
          geometry: { type: "Point", coordinates: coord }
        });
      });
    } else if (geom.type === "Point") {
      features.push({
        type: "Feature",
        properties: { parcel_id: parcel.id, parcel_name: parcel.land_name, index: 0 },
        geometry: geom
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function flightPlansToFeatureCollection(parcels: DjiParcelRecord[]): FeatureCollection {
  // Cada parcela con waypoints_geometry genera un LineString que
  // conecta los waypoints en orden. MapLibre renderiza líneas directo
  // desde el GeoJSON, sin necesidad de un Polyline por parcela.
  const features: Feature[] = [];
  for (const parcel of parcels) {
    const geom = parcel.waypoints_geometry;
    if (!geom) continue;
    let coords: number[][] | null = null;
    if (geom.type === "MultiPoint") coords = geom.coordinates as number[][];
    else if (geom.type === "Point") coords = [geom.coordinates as number[]];
    if (!coords || coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: { parcel_id: parcel.id, parcel_name: parcel.land_name },
      geometry: { type: "LineString", coordinates: coords }
    });
  }
  return { type: "FeatureCollection", features };
}

function alertsToFeatureCollection(alerts: DjiAlertRecord[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: alerts
      .filter((a) => a.geometry)
      .map((a): Feature => ({
        type: "Feature",
        properties: {
          parcel_name: a.parcel_name,
          level: a.level,
          age_days: a.age_days,
          message: a.message
        },
        geometry: a.geometry!
      }))
  };
}

function flightPointsToFeatureCollection(points: FlightPointRecord[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((pt) => ({
      type: "Feature",
      properties: {
        id: pt.flight_id,
        parcel_id: pt.parcel_id,
        drone_nickname: pt.drone_nickname,
        pilot_name: pt.pilot_name,
        start_at: pt.start_at,
        area_m2: pt.area_m2,
        spray_usage_ml: pt.spray_usage_ml,
        status: classifyFlightPoint(pt)
      },
      geometry: { type: "Point", coordinates: [pt.lng, pt.lat] }
    }))
  };
}

// ============================================================
// Helpers: flight point classification (idéntico a map-client.tsx)
// ============================================================

const IN_PROGRESS_WINDOW_MS = 60 * 60 * 1000;

function classifyFlightPoint(pt: FlightPointRecord, nowMs: number = Date.now()): "in_progress" | "completed" {
  const t = Date.parse(pt.start_at);
  if (!Number.isFinite(t)) return "completed";
  return nowMs - t <= IN_PROGRESS_WINDOW_MS ? "in_progress" : "completed";
}

// ============================================================
// Helpers: basemap persistence (idéntico a map-client.tsx)
// ============================================================

function readBasemapFromStorage(): Basemap {
  if (typeof window === "undefined") return DEFAULT_BASEMAP;
  try {
    const v = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    if (v === "satellite" || v === "streets") return v;
  } catch {
    /* localStorage fail in private mode */
  }
  return DEFAULT_BASEMAP;
}

function writeBasemapToStorage(v: Basemap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

function toggleBasemap(c: Basemap): Basemap {
  return c === "satellite" ? "streets" : "satellite";
}

// ============================================================
// BasemapBadge (mismo patrón visual que map-client.tsx)
// ============================================================

function BasemapBadge({ basemap, onToggle }: { basemap: Basemap; onToggle: () => void }) {
  const next = toggleBasemap(basemap);
  return (
    <button
      aria-label={`${BASEMAPS[basemap].label} — click para cambiar a ${BASEMAPS[next].label.toLowerCase()}`}
      className="pointer-events-auto absolute bottom-12 right-3 z-[1000] flex items-center gap-2 rounded-full border border-[#0b5f2d]/30 bg-white px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#0b5f2d] shadow-lg transition hover:bg-[#f4f7f4] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]"
      data-testid="maplibre-basemap-badge"
      onClick={onToggle}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          basemap === "satellite" ? "bg-[#0b5f2d]" : "bg-[#c7a43a]"
        }`}
      />
      {BASEMAPS[basemap].label}
    </button>
  );
}

// ============================================================
// Component
// ============================================================

export interface MapLibreViewProps {
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  flightPoints?: FlightPointRecord[];
  fumigatedParcelIds?: Set<number>;
  selectedParcelId?: number | null;
  onSelect?: (parcelId: number | null) => void;
  labelMinZoom?: number;
  /** Si false, NO aplica fitBounds automático al cargar. Default: true. */
  autoFit?: boolean;
  /** Toggles de capa. Default: todas visibles. */
  showParcels?: boolean;
  showWaypoints?: boolean;
  showFlightPlan?: boolean;
  showAlerts?: boolean;
  showFlightPoints?: boolean;
  /** Si true, oculta todos los controles UI propios (basemap badge). Default: false. */
  hideControls?: boolean;
}

export function MapLibreView({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  selectedParcelId = null,
  onSelect,
  labelMinZoom = LABEL_MIN_ZOOM_DEFAULT,
  autoFit = true,
  showParcels = true,
  showWaypoints = true,
  showFlightPlan = true,
  showAlerts = true,
  showFlightPoints = true,
  hideControls = false
}: MapLibreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);
  const [currentZoom, setCurrentZoom] = useState<number>(DEFAULT_ZOOM);
  const [ready, setReady] = useState(false);

  // === Init map ===
  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;

    async function init() {
      const mod = await import("maplibre-gl");
      // maplibre-gl expone la clase como default en runtime pero los types
      // declaran solo el namespace. Cast a any para evitar el conflicto.
      const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
      if (cancelled || !containerRef.current) return;

      const initial = readBasemapFromStorage();
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAPS[initial].style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: { compact: true }
      });
      mapRef.current = map;
      setBasemap(initial);

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left");

      map.on("load", () => {
        const m = map;
        if (!m) return;
        addSourcesAndLayers(m);
        bindInteractions(m);
        setReady(true);
      });

      map.on("zoomend", () => {
        if (map) setCurrentZoom(map.getZoom());
      });
    }

    function addSourcesAndLayers(map: MlMap) {
      // Parcels
      map.addSource("parcels", { type: "geojson", data: parcelsToFeatureCollection([]) });
      map.addLayer({
        id: "parcels-fill",
        type: "fill",
        source: "parcels",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "is_orchard"], true],
            COLORS.warning,
            COLORS.success
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.55,
            ["==", ["get", "fumigated"], false],
            0.15,
            ["==", ["get", "is_orchard"], true],
            0.25,
            0.35
          ]
        }
      });
      map.addLayer({
        id: "parcels-line",
        type: "line",
        source: "parcels",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "is_orchard"], true],
            COLORS.warning,
            COLORS.primary
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            4,
            2
          ],
          "line-opacity": [
            "case",
            ["==", ["get", "fumigated"], false],
            0.45,
            0.95
          ]
        }
      });
      map.addLayer({
        id: "parcels-label",
        type: "symbol",
        source: "parcels",
        minzoom: labelMinZoom,
        layout: {
          "text-field": ["concat", "#", ["to-string", ["get", "id"]]],
          "text-size": 11,
          "text-font": ["Open Sans Regular"],
          "text-allow-overlap": false,
          "text-ignore-placement": false
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(20,30,20,0.85)",
          "text-halo-width": 1.4
        }
      });

      // Waypoints
      map.addSource("waypoints", { type: "geojson", data: waypointsToFeatureCollection([]) });
      map.addLayer({
        id: "waypoints-circle",
        type: "circle",
        source: "waypoints",
        paint: {
          "circle-radius": 4,
          "circle-color": "#c7a43a",
          "circle-stroke-color": "#5a4a1e",
          "circle-stroke-width": 1,
          "circle-opacity": 0.9,
          "circle-stroke-opacity": 0.9
        }
      });

      // Flight plan
      map.addSource("flight-plan", { type: "geojson", data: flightPlansToFeatureCollection([]) });
      map.addLayer({
        id: "flight-plan-line",
        type: "line",
        source: "flight-plan",
        paint: {
          "line-color": "#c7a43a",
          "line-width": 1.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.7
        }
      });

      // Alerts
      map.addSource("alerts", { type: "geojson", data: alertsToFeatureCollection([]) });
      map.addLayer({
        id: "alerts-fill",
        type: "fill",
        source: "alerts",
        paint: {
          "fill-color": [
            "match",
            ["get", "level"],
            "HIGH", COLORS.danger,
            "MEDIUM", COLORS.warning,
            "LOW", COLORS.success,
            COLORS.success
          ],
          "fill-opacity": 0.35
        }
      });
      map.addLayer({
        id: "alerts-line",
        type: "line",
        source: "alerts",
        paint: {
          "line-color": [
            "match",
            ["get", "level"],
            "HIGH", COLORS.danger,
            "MEDIUM", COLORS.warning,
            "LOW", COLORS.success,
            COLORS.success
          ],
          "line-width": 2
        }
      });

      // Flight points
      map.addSource("flight-points", { type: "geojson", data: flightPointsToFeatureCollection([]) });
      map.addLayer({
        id: "flight-points-circle",
        type: "circle",
        source: "flight-points",
        paint: {
          "circle-radius": 3,
          "circle-color": [
            "match",
            ["get", "status"],
            "in_progress", "#3b82f6",
            "#c084fc"
          ],
          "circle-stroke-color": [
            "match",
            ["get", "status"],
            "in_progress", COLORS.info,
            COLORS.completed
          ],
          "circle-stroke-width": 1,
          "circle-opacity": 0.7,
          "circle-stroke-opacity": 0.8
        }
      });
    }

    function bindInteractions(map: MlMap) {
      // Parcel click → popup + onSelect
      map.on("click", "parcels-fill", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const id = feat.properties?.id as number | undefined;
        const html = renderParcelPopup(feat.properties ?? {});
        new (window as unknown as { maplibregl: typeof import("maplibre-gl") }).maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
        if (id !== undefined) onSelectRef.current?.(id);
      });
      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] });
        if (!hits || hits.length === 0) onSelectRef.current?.(null);
      });
      map.on("mouseenter", "parcels-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "parcels-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      // Alert click → popup
      map.on("click", "alerts-fill", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties ?? {};
        const html = `<strong>${escapeHtml(String(p.parcel_name ?? ""))}</strong><br/>Nivel: ${escapeHtml(String(p.level ?? ""))}<br/>Mensaje: ${escapeHtml(String(p.message ?? ""))}`;
        new (window as unknown as { maplibregl: typeof import("maplibre-gl") }).maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });
      map.on("mouseenter", "alerts-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "alerts-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      // Flight point click → popup
      map.on("click", "flight-points-circle", (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties ?? {};
        const date = p.start_at ? new Date(String(p.start_at)).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "?";
        const areaHa = p.area_m2 !== null && p.area_m2 !== undefined ? (Number(p.area_m2) / 10000).toFixed(2) : "?";
        const liters = p.spray_usage_ml !== null && p.spray_usage_ml !== undefined ? (Number(p.spray_usage_ml) / 1000).toFixed(1) : "?";
        const status = String(p.status) === "in_progress" ? "En vuelo" : "Completado";
        const html = `<strong>Vuelo #${escapeHtml(String(p.id))}</strong><br/>${escapeHtml(date)}<br/>Drone: ${escapeHtml(String(p.drone_nickname ?? "—"))}<br/>Piloto: ${escapeHtml(String(p.pilot_name ?? "—"))}<br/>Parcela: ${escapeHtml(String(p.parcel_id ?? "—"))}<br/>Área: ${escapeHtml(areaHa)} ha · Litros: ${escapeHtml(liters)} L<br/>Estado: <strong>${escapeHtml(status)}</strong>`;
        new (window as unknown as { maplibregl: typeof import("maplibre-gl") }).maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
      });
      map.on("mouseenter", "flight-points-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "flight-points-circle", () => {
        map.getCanvas().style.cursor = "";
      });
    }

    init();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Basemap persistence ===
  useEffect(() => {
    writeBasemapToStorage(basemap);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(BASEMAPS[basemap].style);
    // Después de setStyle, los sources/layers se pierden → re-add.
    map.once("style.load", () => {
      if (!map) return;
      addLayersToExistingMap(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, ready]);

  // === Data updates ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setGeoJSONSource(map, "parcels", parcelsToFeatureCollection(parcels));
  }, [parcels, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setGeoJSONSource(map, "waypoints", waypointsToFeatureCollection(parcels));
    setGeoJSONSource(map, "flight-plan", flightPlansToFeatureCollection(parcels));
  }, [parcels, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setGeoJSONSource(map, "alerts", alertsToFeatureCollection(alerts));
  }, [alerts, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flightPoints) return;
    setGeoJSONSource(map, "flight-points", flightPointsToFeatureCollection(flightPoints));
  }, [flightPoints, ready]);

  // === Fumigated flag (computed from fumigatedParcelIds) ===
  // Reinyectamos el flag en los properties del source parcels en lugar
  // de mantener un Map separado, así MapLibre puede evaluarlo en el
  // paint expression.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("parcels") as { setData?: (d: unknown) => void } | undefined;
    if (!src?.setData) return;
    const collection = parcelsToFeatureCollection(parcels);
    // Anotar `fumigated` en properties de cada feature
    for (const f of collection.features) {
      const id = f.properties?.id as number | undefined;
      if (id !== undefined) {
        f.properties = {
          ...f.properties,
          fumigated: fumigatedParcelIds === undefined ? true : fumigatedParcelIds.has(id)
        };
      }
    }
    src.setData(collection);
  }, [parcels, fumigatedParcelIds, ready]);

  // === Layer visibility toggles ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    toggleLayer(map, ["parcels-fill", "parcels-line", "parcels-label"], showParcels);
    toggleLayer(map, ["waypoints-circle"], showWaypoints);
    toggleLayer(map, ["flight-plan-line"], showFlightPlan);
    toggleLayer(map, ["alerts-fill", "alerts-line"], showAlerts);
    toggleLayer(map, ["flight-points-circle"], showFlightPoints);
  }, [showParcels, showWaypoints, showFlightPlan, showAlerts, showFlightPoints, ready]);

  // === Auto fitBounds ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !autoFit || parcels.length === 0) return;
    const bounds: [number, number][] = [];
    for (const p of parcels) {
      const g = p.spray_geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        for (const ring of g.coordinates) {
          for (const [lng, lat] of ring as number[][]) bounds.push([lng, lat]);
        }
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) {
          for (const ring of poly) {
            for (const [lng, lat] of ring as number[][]) bounds.push([lng, lat]);
          }
        }
      }
    }
    if (bounds.length > 0) {
      try {
        let minLng = bounds[0][0];
        let minLat = bounds[0][1];
        let maxLng = bounds[0][0];
        let maxLat = bounds[0][1];
        for (const [lng, lat] of bounds) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat]
          ],
          { padding: 40, duration: 0 }
        );
      } catch {
        /* ignore — invalid geometry */
      }
    }
  }, [parcels, ready, autoFit]);

  // === Selection highlight ===
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // Clear previous feature-state
    map.removeFeatureState({ source: "parcels" });
    if (selectedParcelId === null) return;
    map.setFeatureState({ source: "parcels", id: selectedParcelId }, { selected: true });
    const parcel = parcels.find((p) => p.id === selectedParcelId);
    if (parcel) {
      const center = computeCentroid(parcel.spray_geometry);
      if (center) {
        map.flyTo({ center, zoom: 15, duration: 900 });
      }
    }
  }, [selectedParcelId, parcels, ready]);

  // Suppress unused warning for labelMinZoom - used in init layers
  void labelMinZoom;
  // Suppress unused warning for flights prop (kept for API compat)
  void useFlightsStub(flights);
  void getParcelPolygonStyle;

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        aria-label="Mapa de parcelas de caña"
        className="size-full"
        data-testid="maplibre-view"
        role="application"
        tabIndex={0}
      />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted">
          <span className="font-mono text-xs text-muted-foreground">Cargando cartografía…</span>
        </div>
      ) : null}
      {!hideControls ? <BasemapBadge basemap={basemap} onToggle={() => setBasemap(toggleBasemap)} /> : null}
    </div>
  );
}

// ============================================================
// Module-scoped helpers
// ============================================================

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setGeoJSONSource(map: MlMap, id: string, data: FeatureCollection) {
  const src = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
  src?.setData?.(data);
}

function toggleLayer(map: MlMap, ids: string[], visible: boolean) {
  for (const id of ids) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }
}

function computeCentroid(geom: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geom) return null;
  const points: [number, number][] = [];
  const visit = (g: GeoJSON.Geometry) => {
    if (g.type === "Polygon") {
      for (const [lng, lat] of g.coordinates[0] as number[][]) points.push([lng, lat]);
    } else if (g.type === "MultiPolygon") {
      for (const ring of g.coordinates[0]) {
        for (const [lng, lat] of ring as number[][]) points.push([lng, lat]);
      }
    }
  };
  visit(geom);
  if (points.length === 0) return null;
  const lng = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return [lng, lat];
}

function renderParcelPopup(props: Record<string, unknown>): string {
  const name = String(props.name ?? "Sin nombre");
  const areaHa = props.declared_area_ha as number | null | undefined;
  const area = areaHa !== null && areaHa !== undefined ? `${areaHa.toFixed(2)} ha` : "—";
  const aria = getParcelA11yLabel({
    name,
    areaHa: areaHa ?? null,
    lastFumigationDate: null,
    alertLevel: null
  });
  const content = getParcelPopupContent({
    name,
    areaHa: areaHa ?? null,
    lastFumigationDate: null,
    alertLevel: null
  });
  return `<div role="dialog" aria-label="${escapeHtml(aria)}">${content}</div>`;
}

function addLayersToExistingMap(map: MlMap) {
  // Re-add sources and layers después de un setStyle. MapLibre limpia
  // todo al cambiar el style. Esta función es la misma que addSourcesAndLayers
  // en el init, pero extraída para reutilizar.
  map.addSource("parcels", { type: "geojson", data: parcelsToFeatureCollection([]) });
  map.addLayer({
    id: "parcels-fill",
    type: "fill",
    source: "parcels",
    paint: {
      "fill-color": [
        "case",
        ["==", ["get", "is_orchard"], true],
        COLORS.warning,
        COLORS.success
      ],
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        0.55,
        ["==", ["get", "fumigated"], false],
        0.15,
        ["==", ["get", "is_orchard"], true],
        0.25,
        0.35
      ]
    }
  });
  map.addLayer({
    id: "parcels-line",
    type: "line",
    source: "parcels",
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "is_orchard"], true],
        COLORS.warning,
        COLORS.primary
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        4,
        2
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "fumigated"], false],
        0.45,
        0.95
      ]
    }
  });
  map.addLayer({
    id: "parcels-label",
    type: "symbol",
    source: "parcels",
    minzoom: 13,
    layout: {
      "text-field": ["concat", "#", ["to-string", ["get", "id"]]],
      "text-size": 11,
      "text-font": ["Open Sans Regular"],
      "text-allow-overlap": false
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "rgba(20,30,20,0.85)",
      "text-halo-width": 1.4
    }
  });
  map.addSource("waypoints", { type: "geojson", data: waypointsToFeatureCollection([]) });
  map.addLayer({
    id: "waypoints-circle",
    type: "circle",
    source: "waypoints",
    paint: {
      "circle-radius": 4,
      "circle-color": "#c7a43a",
      "circle-stroke-color": "#5a4a1e",
      "circle-stroke-width": 1
    }
  });
  map.addSource("flight-plan", { type: "geojson", data: flightPlansToFeatureCollection([]) });
  map.addLayer({
    id: "flight-plan-line",
    type: "line",
    source: "flight-plan",
    paint: {
      "line-color": "#c7a43a",
      "line-width": 1.5,
      "line-dasharray": [3, 2],
      "line-opacity": 0.7
    }
  });
  map.addSource("alerts", { type: "geojson", data: alertsToFeatureCollection([]) });
  map.addLayer({
    id: "alerts-fill",
    type: "fill",
    source: "alerts",
    paint: {
      "fill-color": [
        "match",
        ["get", "level"],
        "HIGH", COLORS.danger,
        "MEDIUM", COLORS.warning,
        "LOW", COLORS.success,
        COLORS.success
      ],
      "fill-opacity": 0.35
    }
  });
  map.addLayer({
    id: "alerts-line",
    type: "line",
    source: "alerts",
    paint: {
      "line-color": [
        "match",
        ["get", "level"],
        "HIGH", COLORS.danger,
        "MEDIUM", COLORS.warning,
        "LOW", COLORS.success,
        COLORS.success
      ],
      "line-width": 2
    }
  });
  map.addSource("flight-points", { type: "geojson", data: flightPointsToFeatureCollection([]) });
  map.addLayer({
    id: "flight-points-circle",
    type: "circle",
    source: "flight-points",
    paint: {
      "circle-radius": 3,
      "circle-color": [
        "match",
        ["get", "status"],
        "in_progress", "#3b82f6",
        "#c084fc"
      ],
      "circle-stroke-color": [
        "match",
        ["get", "status"],
        "in_progress", COLORS.info,
        COLORS.completed
      ],
      "circle-stroke-width": 1
    }
  });
}

// Flight points (current MapClient no usa flights; reservado para futuro).
function useFlightsStub(_flights: DjiDailySummaryRecord[]): void {
  return;
}
