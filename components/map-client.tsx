"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Polyline, Popup, ScaleControl, TileLayer, useMap } from "react-leaflet";

import { waypointsToFlightPlan } from "@/lib/flight-plan";
import { getFlightPlanStyle } from "@/lib/flight-plan-styles";
import { bindParcelLayerInteractions, resolveFeatureStyle, type ParcelContentInput } from "@/lib/map-parcel-content";
import { getAlertPolygonStyle } from "@/lib/map-styles";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";
import { COLORS } from "@/lib/ui-tokens";

const center: [number, number] = [3.4516, -76.532];

/**
 * v1.2 / Track C — toggle de basemap (satellite | streets).
 *
 * Decisiones de producto:
 *   - Default = "satellite": en zona cañera del Valle del Cauca el
 *     supervisor identifica mejor linderos, cultivos y referencias
 *     físicas con vista aérea.
 *   - Persistencia client-side en localStorage (sin round-trip al
 *     server). La app sigue funcionando aunque localStorage falle
 *     (modo privado, sandbox, etc.) — fallback al default.
 *   - Solo se renderiza UN TileLayer activo: si se montaran los dos
 *     se duplicarían los fetch a {z}/{x}/{y} sin beneficio.
 */
type Basemap = "satellite" | "streets";

const BASEMAP_STORAGE_KEY = "afm:map:basemap";
const DEFAULT_BASEMAP: Basemap = "satellite";

const BASEMAPS: Record<Basemap, { label: string; url: string; attribution: string }> = {
  satellite: {
    label: "Satélite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
  },
  streets: {
    label: "Calles",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }
} as const;

function readBasemapFromStorage(): Basemap {
  if (typeof window === "undefined") return DEFAULT_BASEMAP;
  try {
    const value = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    if (value === "satellite" || value === "streets") return value;
  } catch {
    // localStorage puede tirar SecurityError en modo privado o si está deshabilitado.
  }
  return DEFAULT_BASEMAP;
}

function writeBasemapToStorage(value: Basemap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, value);
  } catch {
    // Mismo motivo que arriba: la app sigue funcionando aunque no persista.
  }
}

function toggleBasemap(current: Basemap): Basemap {
  return current === "satellite" ? "streets" : "satellite";
}

function BasemapBadge({ basemap, onToggle }: { basemap: Basemap; onToggle: () => void }) {
  const next = toggleBasemap(basemap);
  return (
    <button
      aria-label={`${BASEMAPS[basemap].label} — click para cambiar a ${BASEMAPS[next].label.toLowerCase()}`}
      className="pointer-events-auto absolute top-3 left-3 z-[1000] flex items-center gap-2 rounded-full border border-[#0b5f2d]/30 bg-white px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-[#0b5f2d] shadow-lg transition hover:bg-[#f4f7f4] focus:outline-none focus:ring-2 focus:ring-[#0b5f2d]"
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

function ZoomControls() {
  const map = useMap();
  return (
    <div className="pointer-events-auto flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
      <button className="border-r border-slate-100 px-3 py-2 text-slate-700 transition hover:bg-slate-50" onClick={() => map.zoomIn()} type="button">+</button>
      <button className="px-3 py-2 text-slate-700 transition hover:bg-slate-50" onClick={() => map.zoomOut()} type="button">-</button>
    </div>
  );
}

function FitBounds({ parcels }: { parcels: DjiParcelRecord[] }) {
  const map = useMap();
  useEffect(() => {
    if (!parcels || parcels.length === 0) return;
    const bounds: [number, number][] = [];
    for (const p of parcels) {
      const geom = p.spray_geometry;
      if (!geom) continue;
      if (geom.type === "Polygon") {
        for (const ring of geom.coordinates) {
          for (const [lng, lat] of ring as number[][]) {
            bounds.push([lat, lng]);
          }
        }
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates) {
          for (const ring of poly) {
            for (const [lng, lat] of ring as number[][]) {
              bounds.push([lat, lng]);
            }
          }
        }
      }
    }
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [40, 40] });
      } catch {
        // ignore — fallback to default center
      }
    }
  }, [parcels, map]);
  return null;
}

/**
 * v1.8 — clasifica un flight point en "en vuelo" vs "completado" según
 * la recencia de su `start_at`. Heurística pragmática:
 *   - start_at dentro de la última hora → "en vuelo" (azul, COLORS.info)
 *   - cualquier otro caso              → "completado" (morado, COLORS.completed)
 *
 * Razonamiento: el modelo de datos actual (FlightPointRecord) no incluye
 * `end_at` ni un `status`. La heurística de 1h es el proxy más cercano
 * a "vuelo en curso" sin necesidad de migración. Si en el futuro se
 * agrega un campo `status`, esta función se ajusta.
 */
const IN_PROGRESS_WINDOW_MS = 60 * 60 * 1000; // 1h

function classifyFlightPoint(pt: FlightPointRecord, nowMs: number = Date.now()): "in_progress" | "completed" {
  const t = Date.parse(pt.start_at);
  if (!Number.isFinite(t)) return "completed";
  return nowMs - t <= IN_PROGRESS_WINDOW_MS ? "in_progress" : "completed";
}

/**
 * v1.8 — color de un flight point según su estado. Tokens en
 * `lib/ui-tokens.ts`:
 *   - "in_progress" → `info` (#1f4d80 azul)
 *   - "completed"   → `completed` (#a855f7 morado)
 */
const FLIGHT_POINT_COLOR: Record<"in_progress" | "completed", { stroke: string; fill: string }> = {
  in_progress: { stroke: COLORS.info, fill: "#3b82f6" },
  completed: { stroke: COLORS.completed, fill: "#c084fc" }
};

export interface MapClientProps {
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  flightPoints?: FlightPointRecord[];
  fumigatedParcelIds?: Set<number>;
  selectedParcelId?: number | null;
  /**
   * v1.8 — threshold de zoom a partir del cual se muestran los labels
   * permanentes de parcela (`#11`, `#16`, etc.). Default 14 (es el
   * zoom inicial del fitBounds; a 14 los polígonos ya son legibles).
   * A zooms < threshold los labels se ocultan para evitar clutter
   * (con 1213 parcelas sería ilegible a nivel departamental).
   */
  labelMinZoom?: number;
}

export function MapClient({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  selectedParcelId = null,
  labelMinZoom = 14
}: MapClientProps) {
  const parcelById = new Map<number, DjiParcelRecord>();
  for (const p of parcels) parcelById.set(p.id, p);

  const alertByParcelId = new Map<number, DjiAlertRecord>();
  for (const a of alerts) {
    if (!alertByParcelId.has(a.parcel_id)) {
      alertByParcelId.set(a.parcel_id, a);
    }
  }

  const mapRef = useRef<L.Map | null>(null);

  // v1.2 / Track C — basemap activo (satellite | streets).
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);

  useEffect(() => {
    setBasemap(readBasemapFromStorage());
  }, []);

  useEffect(() => {
    writeBasemapToStorage(basemap);
  }, [basemap]);

  // v1.8 — estado del zoom para mostrar/ocultar labels. Se inicializa
  // con el zoom default del MapContainer (14). El <ZoomWatcher> hijo
  // del MapContainer lo actualiza en cada `zoomend` event.
  const [currentZoom, setCurrentZoom] = useState<number>(14);
  const handleZoomEnd = useCallback((z: number) => {
    setCurrentZoom(z);
  }, []);

  const parcelCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: parcels
      .filter((parcel) => parcel.spray_geometry)
      .map(
        (parcel): Feature => ({
          type: "Feature",
          properties: {
            id: parcel.id,
            external_id: parcel.external_id,
            name: parcel.land_name,
            field_type: parcel.field_type ?? "Farmland",
            is_orchard: parcel.is_orchard === true,
            spray_area_m2: parcel.spray_area_m2 ?? null,
            declared_area_ha: parcel.declared_area_ha ?? null,
            waypoint_count: parcel.waypoint_count ?? 0
          } satisfies GeoJsonProperties,
          geometry: parcel.spray_geometry!
        })
      )
  };

  const waypointCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: parcels
      .filter((parcel) => parcel.waypoints_geometry)
      .flatMap((parcel): Feature[] => {
        const geom = parcel.waypoints_geometry!;
        if (geom.type === "MultiPoint") {
          return (geom.coordinates as number[][]).map(
            (coord, idx): Feature => ({
              type: "Feature",
              properties: {
                parcel_id: parcel.id,
                parcel_name: parcel.land_name,
                index: idx
              } satisfies GeoJsonProperties,
              geometry: { type: "Point", coordinates: coord }
            })
          );
        }
        if (geom.type === "Point") {
          return [{
            type: "Feature",
            properties: { parcel_id: parcel.id, parcel_name: parcel.land_name, index: 0 } satisfies GeoJsonProperties,
            geometry: geom
          }];
        }
        return [];
      })
  };

  const alertCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: alerts
      .filter((alert) => alert.geometry)
      .map(
        (alert): Feature => ({
          type: "Feature",
          properties: {
            parcel_name: alert.parcel_name,
            level: alert.level,
            age_days: alert.age_days,
            message: alert.message
          } satisfies GeoJsonProperties,
          geometry: alert.geometry!
        })
      )
  };

  // Fallback para el ícono por defecto de Leaflet (CDN roto en webpack/turbo)
  useEffect(() => {
    // @ts-expect-error _getIconUrl existe en runtime
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
    });
  }, []);

  // v1.8 — flag derivado del zoom. Si currentZoom >= labelMinZoom,
  // los polígonos muestran su label permanente (`#11`, etc.).
  const showParcelLabels = currentZoom >= labelMinZoom;

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        className="h-full w-full"
        ref={mapRef}
        scrollWheelZoom
        zoom={14}
      >
        {(() => {
          const config = BASEMAPS[basemap];
          return <TileLayer attribution={config.attribution} url={config.url} />;
        })()}

        <LayersControl position="topright">
          {/*
            v1.8 — las capas están siempre montadas. El `<LayersControl.Overlay>`
            expone su propio checkbox; el operador tildá/destilda desde la UI.
            Antes (v1.7) el `layers` prop de MapView gateaba el render de la
            capa — bug: si la apagabas no la podías volver a encender.
          */}
          <LayersControl.Overlay checked name="Parcelas">
            <GeoJSON
              data={parcelCollection}
              key={`parcels-${showParcelLabels ? "labels" : "no-labels"}`}
              onEachFeature={(feature, layer) => {
                const props = (feature.properties ?? {}) as {
                  id: number;
                  name: string | null;
                  declared_area_ha: number | null;
                };
                const alert = alertByParcelId.get(props.id) ?? null;
                const parcelInput: ParcelContentInput = {
                  name: props.name,
                  areaHa: props.declared_area_ha ?? null,
                  lastFumigationDate: null,
                  totalFlights: undefined,
                  alertLevel: alert?.level ?? null,
                  alertMessage: alert?.message ?? null
                };
                bindParcelLayerInteractions(layer, parcelInput, {
                  onMouseOver: () => {
                    const map = mapRef.current;
                    if (map) map.getContainer().style.cursor = "pointer";
                  },
                  onMouseOut: () => {
                    const map = mapRef.current;
                    if (map) map.getContainer().style.cursor = "";
                  }
                });

                // v1.8 — label permanente con el id de la parcela. Solo si
                // el zoom actual está por encima del threshold; react-leaflet
                // no re-bindea el tooltip cuando cambia el zoom, pero el
                // `key` del `<GeoJSON>` arriba fuerza un remount cuando
                // togglea `showParcelLabels`, así que los labels aparecen
                // o desaparecen al cruzar el threshold.
                if (showParcelLabels) {
                  layer.bindTooltip(
                    `<span class="parcel-label">#${props.id}</span>`,
                    {
                      permanent: true,
                      direction: "center",
                      className: "map-parcel-label"
                    }
                  );
                }
              }}
              style={(feature) => {
                return resolveFeatureStyle(
                  feature,
                  parcelById,
                  selectedParcelId,
                  fumigatedParcelIds
                );
              }}
            />
          </LayersControl.Overlay>

          {waypointCollection.features.length > 0 ? (
            <LayersControl.Overlay checked name="Waypoints del plan">
              <GeoJSON
                data={waypointCollection}
                pointToLayer={(_feature, latlng) =>
                  L.circleMarker(latlng, {
                    radius: 4,
                    fillColor: "#c7a43a",
                    color: "#5a4a1e",
                    weight: 1,
                    opacity: 0.9,
                    fillOpacity: 0.85
                  })
                }
                onEachFeature={(feature, layer) => {
                  const p = feature.properties ?? {};
                  layer.bindPopup(
                    `<strong>Waypoint</strong> #${p.index}<br/>Parcela: ${p.parcel_name ?? "?"}`
                  );
                }}
              />
            </LayersControl.Overlay>
          ) : null}

          {parcels
            .filter((parcel) => parcel.waypoints_geometry)
            .map((parcel) => {
              const planGeom = waypointsToFlightPlan(parcel.waypoints_geometry);
              if (!planGeom) return null;
              const positions: Array<[number, number]> | Array<Array<[number, number]>> =
                planGeom.type === "LineString"
                  ? (planGeom.coordinates as Array<[number, number]>)
                  : (planGeom.coordinates as Array<Array<[number, number]>>);
              return (
                <Polyline
                  key={`flightplan-${parcel.id}`}
                  pathOptions={getFlightPlanStyle()}
                  positions={positions}
                >
                  <Popup>
                    <strong>Plan de vuelo</strong>
                    <br />
                    Parcela: {parcel.land_name ?? "?"}
                    <br />
                    {parcel.waypoint_count ?? "?"} waypoints
                  </Popup>
                </Polyline>
              );
            })}

          {alerts.length > 0 ? (
            <LayersControl.Overlay checked name="Alertas">
              <GeoJSON
                data={alertCollection}
                onEachFeature={(feature, layer) => {
                  layer.bindPopup(
                    `<strong>${feature.properties?.parcel_name}</strong><br/>Nivel: ${feature.properties?.level}<br/>Mensaje: ${feature.properties?.message}`
                  );
                }}
                style={(feature) => {
                  const level = (feature?.properties as { level?: DjiAlertRecord["level"] } | null)?.level ?? "LOW";
                  return getAlertPolygonStyle(level);
                }}
              />
            </LayersControl.Overlay>
          ) : null}

          {flightPoints && flightPoints.length > 0 ? (
            <LayersControl.Overlay checked name={`Vuelos (${flightPoints.length})`}>
              {flightPoints.map((pt) => {
                const areaHa = pt.area_m2 !== null ? (pt.area_m2 / 10000).toFixed(2) : "?";
                const liters = pt.spray_usage_ml !== null ? (pt.spray_usage_ml / 1000).toFixed(1) : "?";
                const date = new Date(pt.start_at).toLocaleString("es-CO", {
                  dateStyle: "short",
                  timeStyle: "short"
                });
                const status = classifyFlightPoint(pt);
                const colors = FLIGHT_POINT_COLOR[status];
                return (
                  <CircleMarker
                    center={[pt.lat, pt.lng]}
                    key={pt.flight_id}
                    radius={3}
                    pathOptions={{
                      color: colors.stroke,
                      weight: 1,
                      fillColor: colors.fill,
                      fillOpacity: 0.7,
                      opacity: 0.8
                    }}
                  >
                    <Popup>
                      <strong>Vuelo #{pt.flight_id}</strong>
                      <br />
                      {date}
                      <br />
                      Drone: {pt.drone_nickname ?? "—"}
                      <br />
                      Piloto: {pt.pilot_name ?? "—"}
                      <br />
                      Parcela: {pt.parcel_id ?? "—"}
                      <br />
                      Área: {areaHa} ha · Litros: {liters} L
                      <br />
                      Estado: <strong>{status === "in_progress" ? "En vuelo" : "Completado"}</strong>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </LayersControl.Overlay>
          ) : null}
        </LayersControl>
        <ZoomControls />
        {/*
          v1.8 — ScaleControl nativo de Leaflet (barra "1 km" en el
          bottom-left). `metric: true` para kilómetros, `imperial: false`
          (Colombia usa sistema métrico). Posición por defecto: bottomleft.
        */}
        <ScaleControl imperial={false} metric position="bottomleft" />
        <ZoomWatcher onZoomEnd={handleZoomEnd} />
        <FitBounds parcels={parcels} />
      </MapContainer>
      <BasemapBadge basemap={basemap} onToggle={() => setBasemap(toggleBasemap)} />
    </div>
  );
}

/**
 * v1.8 — listener del zoom del mapa. Se monta DENTRO del MapContainer
 * (usa `useMap()`) y avisa al padre cuando el zoom cambia para que
 * togglee los labels de parcela.
 */
function ZoomWatcher({ onZoomEnd }: { onZoomEnd: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handler = () => onZoomEnd(map.getZoom());
    map.on("zoomend", handler);
    // Inicializar el state con el zoom actual.
    onZoomEnd(map.getZoom());
    return () => {
      map.off("zoomend", handler);
    };
  }, [map, onZoomEnd]);
  return null;
}
