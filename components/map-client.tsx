"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { useEffect } from "react";
import { GeoJSON, LayersControl, MapContainer, TileLayer, useMap } from "react-leaflet";

import type { DjiAlertRecord, DjiAssetRecord, DjiDailySummaryRecord } from "@/lib/types";

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

type NormalizedParcel = DjiAssetRecord & {
  // Campos del modelo Opción B (pueden estar presentes cuando MapView pasa DjiParcelRecord)
  spray_geometry?: GeoJSON.Geometry | null;
  waypoints_geometry?: GeoJSON.Geometry | null;
  waypoint_count?: number | null;
  is_orchard?: boolean;
  spray_area_m2?: number | null;
  field_type?: string;
};

function parcelStyle(feature?: { properties?: { is_orchard?: boolean } | null }) {
  const isOrchard = feature?.properties?.is_orchard === true;
  return {
    color: isOrchard ? "#7b3f00" : "#0b5f2d",
    weight: 2,
    fillColor: isOrchard ? "#f4a460" : "#90EE90",
    fillOpacity: 0.35
  };
}

function alertStyle(level: DjiAlertRecord["level"]) {
  if (level === "HIGH") return { color: "#ba1a1a", weight: 2, fillColor: "#ff6b6b", fillOpacity: 0.35 };
  if (level === "MEDIUM") return { color: "#FFD700", weight: 2, fillColor: "#FFD700", fillOpacity: 0.3 };
  return { color: "#228B22", weight: 2, fillColor: "#90EE90", fillOpacity: 0.25 };
}

function FitBounds({ parcels }: { parcels: NormalizedParcel[] }) {
  const map = useMap();
  useEffect(() => {
    if (!parcels || parcels.length === 0) return;
    // Intentar ajustar el mapa al bounding box de las parcelas
    const bounds: [number, number][] = [];
    for (const p of parcels) {
      const geom = p.spray_geometry ?? p.geometry;
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
  layers = { parcels: true, waypoints: true, alerts: true }
}: {
  parcels: NormalizedParcel[];
  flights: DjiDailySummaryRecord[];
  alerts: DjiAlertRecord[];
  layers?: { parcels: boolean; waypoints: boolean; alerts: boolean };
}) {
  const parcelCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: parcels
      .filter((parcel) => parcel.spray_geometry || parcel.geometry)
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
          geometry: (parcel.spray_geometry ?? parcel.geometry)!
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
                style={parcelStyle}
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
                style={(feature) => alertStyle((feature?.properties?.level as DjiAlertRecord["level"]) ?? "LOW")}
              />
            </LayersControl.Overlay>
          )}
        </LayersControl>
        <ZoomControls />
        <FitBounds parcels={parcels} />
      </MapContainer>
    </div>
  );
}
