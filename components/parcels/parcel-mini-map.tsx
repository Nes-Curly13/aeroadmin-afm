"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import type { Feature, FeatureCollection, GeoJsonProperties } from "geojson";
import { useEffect } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";

import type { DjiParcelRecord } from "@/lib/types";

function FitToParcel({ parcel }: { parcel: DjiParcelRecord }) {
  const map = useMap();
  useEffect(() => {
    if (!parcel.spray_geometry) return;
    const coords: [number, number][] = [];
    const collect = (g: GeoJSON.Geometry) => {
      if (g.type === "Polygon") {
        for (const ring of g.coordinates) {
          for (const [lng, lat] of ring as number[][]) {
            coords.push([lat, lng]);
          }
        }
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates) {
          for (const ring of poly) {
            for (const [lng, lat] of ring as number[][]) {
              coords.push([lat, lng]);
            }
          }
        }
      }
    };
    collect(parcel.spray_geometry);
    if (parcel.waypoints_geometry) collect(parcel.waypoints_geometry);
    if (parcel.reference_point) {
      const rp = parcel.reference_point;
      if (rp.type === "Point") coords.push([rp.coordinates[1], rp.coordinates[0]]);
    }
    if (coords.length > 0) {
      try {
        map.fitBounds(coords, { padding: [50, 50], maxZoom: 18 });
      } catch {
        // ignore
      }
    }
  }, [parcel, map]);
  return null;
}

export function ParcelMiniMap({ parcel }: { parcel: DjiParcelRecord }) {
  // Polygon de la spray zone
  const sprayCollection: FeatureCollection | null = parcel.spray_geometry
    ? {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: parcel.spray_geometry,
            properties: { kind: "spray" } satisfies GeoJsonProperties
          } as Feature
        ]
      }
    : null;

  // Waypoints del plan
  const waypointCollection: FeatureCollection = {
    type: "FeatureCollection",
    features:
      parcel.waypoints_geometry?.type === "MultiPoint"
        ? (parcel.waypoints_geometry.coordinates as number[][]).map(
            (coord, idx): Feature => ({
              type: "Feature",
              properties: { index: idx, kind: "waypoint" } satisfies GeoJsonProperties,
              geometry: { type: "Point", coordinates: coord }
            })
          )
        : parcel.waypoints_geometry?.type === "Point"
          ? [{ type: "Feature", properties: { index: 0, kind: "waypoint" } satisfies GeoJsonProperties, geometry: parcel.waypoints_geometry }]
          : []
  };

  // Home point
  const refPoint: Feature | null =
    parcel.reference_point?.type === "Point"
      ? { type: "Feature", properties: { kind: "home" } satisfies GeoJsonProperties, geometry: parcel.reference_point }
      : null;

  // Fallback para L.Icon (mismo fix que MapClient)
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
    <div className="h-[280px]">
      <MapContainer
        center={[3.4516, -76.532]}
        className="h-full w-full"
        scrollWheelZoom={false}
        zoom={16}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {sprayCollection && (
          <GeoJSON
            data={sprayCollection}
            style={() => ({
              color: parcel.is_orchard ? "#7b3f00" : "#0b5f2d",
              weight: 2,
              fillColor: parcel.is_orchard ? "#f4a460" : "#90EE90",
              fillOpacity: 0.4
            })}
          />
        )}
        {waypointCollection.features.length > 0 && (
          <GeoJSON
            data={waypointCollection}
            pointToLayer={(_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 3,
                fillColor: "#c7a43a",
                color: "#5a4a1e",
                weight: 1,
                opacity: 0.9,
                fillOpacity: 0.85
              })
            }
          />
        )}
        {refPoint && (
          <GeoJSON
            data={{ type: "FeatureCollection", features: [refPoint] } as FeatureCollection}
            pointToLayer={(_feature, latlng) =>
              L.circleMarker(latlng, {
                radius: 6,
                fillColor: "#ba1a1a",
                color: "#5a0000",
                weight: 2,
                opacity: 1,
                fillOpacity: 1
              })
            }
          />
        )}
        <FitToParcel parcel={parcel} />
      </MapContainer>
    </div>
  );
}
