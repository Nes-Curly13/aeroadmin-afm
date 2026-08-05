"use client";

/**
 * FumigationMap — mapa MapLibre con basemap satelital (Sentinel-2 2024)
 * que muestra la geometría de la parcela + un punto en el centroide
 * de la fumigación + (opcional) los flights asociados.
 *
 * Sprint 2026-08-05 — feature/nav-fumigaciones.
 * Usado por:
 *   - /fumigacion/[id] (ficha de fumigación individual)
 *   - /fumigaciones/nueva (form de alta con mapa de fondo satelital)
 *
 * Decisiones:
 *   - Sentinel-2 2024 (no 2020) — color más fresco, casi no se nota
 *     la diferencia con un mapa comercial. Verificado en Valle del
 *     Cauca en z=12-14.
 *   - Bounds del polígono de la parcela (fit-to-bounds) — si la parcela
 *     es chica, el centroide de la fumigación cae adentro y se ve
 *     el pin. Si la fumigación NO tiene flights (caso manual sin
 *     asociar), igual mostramos el polígono de la parcela.
 *   - Dron_route (línea) si hay flight_ids. Se conecta el centroide
 *     con un marcador grande y los flights como puntitos.
 *
 * No testea en unit (necesita MapLibre + DOM real); E2E Playwright.
 */

import type { Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

interface FlightPoint {
  id: number | string;
  lng: number;
  lat: number;
  pilot?: string;
  drone_model?: string;
}

export function FumigationMap({
  parcelGeom,
  fumigationPoint,
  flights = [],
  className
}: {
  /** Geometría de la parcela (Polygon). Opcional — si no hay, se
   * centra solo en el punto de la fumigación. */
  parcelGeom?: { type: "Polygon"; coordinates: number[][][] } | null;
  /** Centroide lat/lng de la fumigación (de flight_ids en BD). */
  fumigationPoint?: { lat: number; lng: number } | null;
  /** Vuelos asociados a la fumigación (opcional). */
  flights?: FlightPoint[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let map: MlMap | null = null;
    let cancelled = false;

    async function init() {
      const maplibregl = await import("maplibre-gl");
      if (cancelled || !containerRef.current) return;

      // Calcular bounds: de la parcela si la hay, sino del punto.
      let bounds: [[number, number], [number, number]] | null = null;
      if (parcelGeom) {
        const ring = parcelGeom.coordinates[0];
        const lngs = ring.map((c) => c[0]);
        const lats = ring.map((c) => c[1]);
        bounds = [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)]
        ];
      } else if (fumigationPoint) {
        // Padding alrededor del punto (1km aprox en grados)
        const pad = 0.01;
        bounds = [
          [fumigationPoint.lng - pad, fumigationPoint.lat - pad],
          [fumigationPoint.lng + pad, fumigationPoint.lat + pad]
        ];
      }

      const mapConfig: ConstructorParameters<typeof maplibregl.Map>[0] = {
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            // Sentinel-2 cloudless 2024 — color más fresco que 2020
            eox: {
              type: "raster",
              tiles: [
                "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"
              ],
              tileSize: 256,
              maxzoom: 14,
              attribution:
                "Sentinel-2 cloudless 2024 © <a href=\"https://eox.at\" target=\"_blank\" rel=\"noopener\">EOX</a>"
            }
          },
          layers: [{ id: "eox", type: "raster", source: "eox" }]
        },
        attributionControl: { compact: true }
      };
      if (bounds) {
        mapConfig.bounds = bounds;
        mapConfig.fitBoundsOptions = { padding: 30, maxZoom: 17 };
      } else {
        mapConfig.center = [-76.31, 3.45];
        mapConfig.zoom = 12;
      }

      map = new maplibregl.Map(mapConfig);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", () => {
        if (!map) return;

        // Polígono de la parcela
        if (parcelGeom) {
          map.addSource("parcel", {
            type: "geojson",
            data: { type: "Feature", geometry: parcelGeom, properties: {} }
          });
          map.addLayer({
            id: "parcel-fill",
            type: "fill",
            source: "parcel",
            paint: { "fill-color": "#16a34a", "fill-opacity": 0.25 }
          });
          map.addLayer({
            id: "parcel-line",
            type: "line",
            source: "parcel",
            paint: { "line-color": "#16a34a", "line-width": 2.4 }
          });
        }

        // Marcador grande de la fumigación (centroide)
        if (fumigationPoint) {
          const el = document.createElement("div");
          el.style.cssText = [
            "width: 22px",
            "height: 22px",
            "border-radius: 50%",
            "background: #f5e839",
            "border: 3px solid #1f2937",
            "box-shadow: 0 0 0 4px rgba(245,232,57,0.35)",
            "cursor: pointer"
          ].join(";");
          el.title = "Centroide de la fumigación";
          new maplibregl.Marker({ element: el })
            .setLngLat([fumigationPoint.lng, fumigationPoint.lat])
            .addTo(map);
        }

        // Flights como puntos pequeños
        if (flights.length > 0) {
          map.addSource("flights", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: flights.map((f) => ({
                type: "Feature" as const,
                geometry: {
                  type: "Point" as const,
                  coordinates: [f.lng, f.lat]
                },
                properties: { id: String(f.id), pilot: f.pilot ?? "" }
              }))
            }
          });
          map.addLayer({
            id: "flights-circle",
            type: "circle",
            source: "flights",
            paint: {
              "circle-radius": 3,
              "circle-color": "#fff",
              "circle-opacity": 0.9,
              "circle-stroke-color": "#1f2937",
              "circle-stroke-width": 1
            }
          });
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
  }, [parcelGeom, fumigationPoint, flights]);

  return (
    <div
      className={
        "relative h-72 w-full overflow-hidden rounded-lg border border-border " +
        (className ?? "")
      }
    >
      <div
        ref={containerRef}
        className="size-full"
        role="application"
        aria-label="Mapa de la fumigación con basemap satelital"
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted/60">
          <span className="font-mono text-xs text-muted-foreground">Cargando mapa satelital…</span>
        </div>
      )}
    </div>
  );
}
