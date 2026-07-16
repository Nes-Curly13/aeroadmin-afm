"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { useEffect } from "react";
import { CircleMarker, GeoJSON, LayersControl, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";

import { getAlertPolygonStyle, getParcelPolygonStyle } from "@/lib/map-styles";
import type { DjiAlertRecord, DjiDailySummaryRecord, DjiParcelRecord, FlightPointRecord } from "@/lib/types";

const center: [number, number] = [3.4516, -76.532];

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
  layers = { parcels: true, waypoints: true, alerts: true, flights: true }
}: {
  // (S2 / 2026-07-01) Solo DjiParcelRecord. El legacy DjiAssetRecord (3-rows-per-field)
  // se eliminó junto con getParcels() y el endpoint /api/parcels.
  parcels: DjiParcelRecord[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  // M6: footprint minimo por sortie individual. Si viene undefined la capa
  // se considera deshabilitada (no falla).
  flightPoints?: FlightPointRecord[];
  layers?: { parcels: boolean; waypoints: boolean; alerts: boolean; flights: boolean };
}) {
  // Construimos un Map id -> DjiParcelRecord para que el `style` callback
  // del GeoJSON pueda resolver la parcela original y delegar a
  // `getParcelPolygonStyle` (lib/map-styles.ts — single source of truth).
  const parcelById = new Map<number, DjiParcelRecord>();
  for (const p of parcels) parcelById.set(p.id, p);

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
      <MapContainer center={center} className="h-full w-full" scrollWheelZoom zoom={14}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <LayersControl position="topright">
          {layers.parcels && (
            <LayersControl.Overlay checked name="Parcelas">
              <GeoJSON
                data={parcelCollection}
                onEachFeature={(feature, layer) => {
                  const p = feature.properties ?? {};
                  const popup = `
                    <strong>${p.name ?? "Sin nombre"}</strong><br/>
                    Tipo: ${p.field_type ?? "?"} ${p.is_orchard ? "(Orchard)" : "(Farmland)"}<br/>
                    Área fumigable: ${p.spray_area_m2 ? (p.spray_area_m2 / 10000).toFixed(3) + " ha" : "?"}<br/>
                    Waypoints: ${p.waypoint_count ?? 0}<br/>
                    <small>${p.external_id ?? ""}</small>
                  `;
                  layer.bindPopup(popup);
                }}
                style={(feature) => {
                  // Resolvemos la parcela original a partir del id y delegamos
                  // a lib/map-styles.ts. Si no se encuentra, fallback defensivo
                  // a un estilo neutral (primary) sin romper el render.
                  const id = (feature?.properties as { id?: number } | null)?.id;
                  const parcel = id !== undefined ? parcelById.get(id) : undefined;
                  if (!parcel) {
                    return getParcelPolygonStyle({} as DjiParcelRecord);
                  }
                  return getParcelPolygonStyle(parcel);
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
    </div>
  );
}
