"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { useEffect, useRef, useState } from "react";
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

import { waypointsToFlightPlan } from "@/lib/flight-plan";
import { getFlightPlanStyle } from "@/lib/flight-plan-styles";
import { bindParcelLayerInteractions, resolveFeatureStyle, type ParcelContentInput } from "@/lib/map-parcel-content";
import { getAlertPolygonStyle, getParcelPolygonStyle } from "@/lib/map-styles";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

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
 *
 * Atribuciones:
 *   - Esri World Imagery: el wording oficial de Esri exige mantener
 *     la lista de data providers intacta (Esri, i-cubed, USDA, USGS,
 *     etc.) — es parte de los términos de uso del servicio.
 *   - OSM: contributors + link a la página de copyright.
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

/**
 * Badge clickeable que muestra el basemap activo y permite alternar.
 * Verde olivo coherente con el resto del AFM (paleta de lib/ui-tokens.ts).
 * Posición: top-left del wrapper, fuera del MapContainer, para no chocar
 * con el LayersControl (top-right) ni con los zoom controls (que Leaflet
 * renderiza a su top-left interno).
 */
function BasemapBadge({ basemap, onToggle }: { basemap: Basemap; onToggle: () => void }) {
  const next = toggleBasemap(basemap);
  // aria-label anuncia el estado ACTUAL primero, después el hint de acción.
  // Decisión UX: un screen reader debe enterarse de qué basemap está
  // viendo, no solo de qué click haría. El texto visible ("Satélite" /
  // "Calles") ya coincide con el prefijo del aria-label.
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
    // Intentar ajustar el mapa al bounding box de las parcelas
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

export function MapClient({
  parcels,
  flights,
  alerts,
  flightPoints,
  fumigatedParcelIds,
  selectedParcelId,
  layers = { parcels: true, waypoints: true, alerts: true, flights: true, flightPlans: false }
}: {
  // (S2 / 2026-07-01) Solo DjiParcelRecord. El legacy DjiAssetRecord (3-rows-per-field)
  // se eliminó junto con getParcels() y el endpoint /api/parcels.
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  // M6: footprint minimo por sortie individual. Si viene undefined la capa
  // se considera deshabilitada (no falla).
  flightPoints?: FlightPointRecord[];
  // M3-M5 Track A: parcel_ids fumigados en los últimos 6m. Si undefined
  // o parcel no presente en el set, se renderiza como fumigada (compat).
  fumigatedParcelIds?: Set<number>;
  // M3-M5 Track C: id de la parcela actualmente seleccionada en el panel
  // derecho. Se usa para diferenciar visualmente (weight=4 + dashArray
  // removido) y para centrar el mapa vía MapFocusOn (commit 3).
  selectedParcelId?: number | null;
  // M3-M5 Track B: opt-in (default false). Renderiza la geometría del
  // plan DJI como polilínea dashed. Independiente de `waypoints` (que
  // muestra los dots sueltos) — decisión: dos capas independientes
  // para que el operador pueda elegir ver "plan completo" o
  // "waypoints sueltos" según el caso de uso.
  layers?: {
    parcels: boolean;
    waypoints: boolean;
    alerts: boolean;
    flights: boolean;
    flightPlans: boolean;
  };
}) {
  // Construimos un Map id -> DjiParcelRecord para que el `style` callback
  // del GeoJSON pueda resolver la parcela original y delegar a
  // `getParcelPolygonStyle` (lib/map-styles.ts — single source of truth).
  const parcelById = new Map<number, DjiParcelRecord>();
  for (const p of parcels) parcelById.set(p.id, p);

  // Track C: Mapa id -> DjiAlertRecord para inyectar el nivel de alerta
  // en el popup de cada parcela. Una misma parcela puede tener varias
  // alertas (HIGH por área, MEDIUM por cadencia) — agarramos la primera
  // para el popup, priorizando HIGH (orden natural del array alerts
  // viene de la query en repositories).
  const alertByParcelId = new Map<number, DjiAlertRecord>();
  for (const a of alerts) {
    if (!alertByParcelId.has(a.parcel_id)) {
      alertByParcelId.set(a.parcel_id, a);
    }
  }

  // Track C: ref al MapContainer para acceder al map instance desde
  // handlers de mouseover/mouseout (cambio de cursor). useMap() no
  // funciona acá porque MapClient renderiza <MapContainer> (no es
  // hijo de él). Usar ref de MapContainer es el patrón estándar.
  const mapRef = useRef<L.Map | null>(null);

  // v1.2 / Track C — basemap activo (satellite | streets). Persistencia
  // client-side: leer en mount, escribir en cada cambio. Si localStorage
  // no está disponible, ambos helpers caen al default silenciosamente.
  const [basemap, setBasemap] = useState<Basemap>(DEFAULT_BASEMAP);

  useEffect(() => {
    setBasemap(readBasemapFromStorage());
  }, []);

  useEffect(() => {
    writeBasemapToStorage(basemap);
  }, [basemap]);

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

  // Construimos el MultiPoint para los waypoints: si el parcel tiene
  // waypoints_geometry (de dji_parcels.waypoints), lo usamos; sino vacío.
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

  return (
    <div className="relative h-[72vh] overflow-hidden rounded-[24px]">
      <MapContainer
        center={center}
        className="h-full w-full"
        ref={mapRef}
        scrollWheelZoom
        zoom={14}
      >
        {(() => {
          // v1.2 / Track C: solo se monta UN TileLayer activo (no se
          // duplican los fetch a {z}/{x}/{y}). La config vive en
          // BASEMAPS para que un cambio de URL/attribution sea un
          // edit único, no dos.
          const config = BASEMAPS[basemap];
          return <TileLayer attribution={config.attribution} url={config.url} />;
        })()}
        <LayersControl position="topright">
          {layers.parcels && (
            <LayersControl.Overlay checked name="Parcelas">
              <GeoJSON
                data={parcelCollection}
                onEachFeature={(feature, layer) => {
                  // M3-M5 Track C: bindTooltip (hover preview) + bindPopup
                  // (click expanded) + cursor change. Todo el contenido se
                  // delega a los helpers puros de lib/map-parcel-content
                  // para mantener la lógica testeable sin Leaflet.
                  const props = (feature.properties ?? {}) as {
                    id: number;
                    name: string | null;
                    declared_area_ha: number | null;
                  };
                  const alert = alertByParcelId.get(props.id) ?? null;
                  const parcelInput: ParcelContentInput = {
                    name: props.name,
                    areaHa: props.declared_area_ha ?? null,
                    // TODO (commit futuro): joinear con dji_fumigation_schedule
                    // para traer la última fecha de fumigación por parcela.
                    lastFumigationDate: null,
                    // TODO (commit futuro): agregación desde dji_flights
                    // (parcel_id -> COUNT(*)) para el total de sorties.
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
                }}
                style={(feature) => {
                  // M3-M5 Track C: dispatch centralizado. Delega en
                  // lib/map-styles.ts (Track A) para isSelected+hasFumigation
                  // y aplica el override "seleccionada = línea sólida"
                  // removiendo dashArray del spread.
                  return resolveFeatureStyle(
                    feature,
                    parcelById,
                    selectedParcelId ?? null,
                    fumigatedParcelIds
                  );
                }}
              />
            </LayersControl.Overlay>
          )}
          {layers.waypoints && waypointCollection.features.length > 0 && (
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
          )}
          {layers.flightPlans &&
            parcels
              .filter((parcel) => parcel.waypoints_geometry)
              .map((parcel) => {
                // Convertir waypoints_geometry → plan lineal (LineString
                // o MultiLineString) usando la heurística nearest-neighbor
                // de lib/flight-plan.ts.
                const planGeom = waypointsToFlightPlan(parcel.waypoints_geometry);
                if (!planGeom) return null;
                // Leaflet <Polyline> acepta positions: LatLngExpression[][]
                // para MultiLineString o LatLngExpression[] para LineString.
                const positions: Array<[number, number]> | Array<Array<[number, number]>> =
                  planGeom.type === "LineString"
                    ? (planGeom.coordinates as Array<[number, number]>)
                    : (planGeom.coordinates as Array<Array<[number, number]>>);
                // isSelected queda false por ahora — MapView no nos pasa
                // la selección (vive en su state). Si en el futuro se
                // quiere highlighting del plan de la parcela activa, agregar
                // prop `selectedParcelId?: number` y pasarlo desde MapView.
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
          {layers.alerts && (
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
          )}
          {layers.flights && flightPoints && flightPoints.length > 0 && (
            <LayersControl.Overlay checked name={`Vuelos (${flightPoints.length})`}>
              {flightPoints.map((pt) => {
                const areaHa = pt.area_m2 !== null ? (pt.area_m2 / 10000).toFixed(2) : "?";
                const liters = pt.spray_usage_ml !== null ? (pt.spray_usage_ml / 1000).toFixed(1) : "?";
                const date = new Date(pt.start_at).toLocaleString("es-CO", {
                  dateStyle: "short",
                  timeStyle: "short"
                });
                return (
                  <CircleMarker
                    center={[pt.lat, pt.lng]}
                    key={pt.flight_id}
                    radius={3}
                    pathOptions={{
                      color: "#0b5f2d",
                      weight: 1,
                      fillColor: "#22c55e",
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
                    </Popup>
                  </CircleMarker>
                );
              })}
            </LayersControl.Overlay>
          )}
        </LayersControl>
        <ZoomControls />
        <FitBounds parcels={parcels} />
      </MapContainer>
      <BasemapBadge basemap={basemap} onToggle={() => setBasemap(toggleBasemap)} />
    </div>
  );
}
