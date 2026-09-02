"use client";

/**
 * FumigationMap — mapa MapLibre con basemap satelital (Sentinel-2 2024)
 * que muestra la geometría de la(s) parcela(s) + un punto en el centroide
 * de la fumigación + (opcional) los flights asociados.
 *
 * Sprint 2026-08-05 — feature/nav-fumigaciones.
 * Sprint S9 (2026-08-30) — feature/standalone-fumigation-v2: soporte
 * multi-parcela vía prop `parcels` (1 primaria + N secundarias). La API
 * legacy `parcelGeom` (single) sigue funcionando para el form de alta
 * (/fumigaciones/nueva), que es single-parcela por diseño.
 *
 * Usado por:
 *   - /fumigacion/[id] (ficha de fumigación individual) — usa `parcels`
 *   - /fumigaciones/nueva (form de alta con mapa de fondo satelital)
 *     — usa `parcelGeom` legacy (single parcela)
 *
 * Decisiones:
 *   - Sentinel-2 2024 (no 2020) — color más fresco, casi no se nota
 *     la diferencia con un mapa comercial. Verificado en Valle del
 *     Cauca en z=12-14.
 *   - Bounds del polígono de la parcela (fit-to-bounds) — si la parcela
 *     es chica, el centroide de la fumigación cae adentro y se ve
 *     el pin. Si la fumigación NO tiene flights (caso manual sin
 *     asociar), igual mostramos el polígono de la parcela.
 *   - Multi-parcela: la primaria se renderiza en verde saturado (#16a34a)
 *     con borde grueso; las secundarias en verde más claro (#86efac) con
 *     borde más fino. Así se distinguen a primera vista sin tener que
 *     clickear.
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

/** Polígono de parcela con metadata mínima. Usado por el modo multi-parcela. */
export interface FumigationMapParcel {
  id: number;
  is_primary: boolean;
  land_name?: string | null;
  /** GeoJSON Polygon. Si null, no se renderiza pero aparece en la leyenda. */
  geometry: GeoJSON.Geometry | null;
}

export function FumigationMap({
  parcelGeom,
  parcels,
  fumigationPoint,
  flights = [],
  className
}: {
  /** LEGACY — single parcela. Si se pasa `parcels`, se ignora. */
  parcelGeom?: { type: "Polygon"; coordinates: number[][][] } | null;
  /** Multi-parcela: 1 primaria + N secundarias. Reemplaza a `parcelGeom`. */
  parcels?: FumigationMapParcel[];
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

      // Normalizar a un array de polígonos. Si viene `parcels`, lo usamos;
      // si no, caemos al legacy `parcelGeom` (single).
      const polygons: Array<{
        isPrimary: boolean;
        geom: GeoJSON.Geometry;
        label?: string | null;
      }> = [];
      if (parcels && parcels.length > 0) {
        for (const p of parcels) {
          if (p.geometry) {
            polygons.push({ isPrimary: p.is_primary, geom: p.geometry, label: p.land_name });
          }
        }
      } else if (parcelGeom) {
        polygons.push({ isPrimary: true, geom: parcelGeom });
      }

      // Calcular bounds sobre TODOS los polígonos (o el punto si no hay).
      let bounds: [[number, number], [number, number]] | null = null;
      const ringLngs: number[] = [];
      const ringLats: number[] = [];
      for (const p of polygons) {
        if (p.geom.type === "Polygon") {
          for (const c of p.geom.coordinates[0]) {
            ringLngs.push(c[0]);
            ringLats.push(c[1]);
          }
        } else if (p.geom.type === "MultiPolygon") {
          for (const poly of p.geom.coordinates) {
            for (const c of poly[0]) {
              ringLngs.push(c[0]);
              ringLats.push(c[1]);
            }
          }
        }
      }
      if (ringLngs.length > 0) {
        bounds = [
          [Math.min(...ringLngs), Math.min(...ringLats)],
          [Math.max(...ringLngs), Math.max(...ringLats)]
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

        // Polígonos de las parcelas. Cada uno con source/layer propios
        // para que la primaria tenga estilo distinto de las secundarias.
        polygons.forEach((p, idx) => {
          const sourceId = `parcel-${idx}`;
          const isPrimary = p.isPrimary;
          const fillColor = isPrimary ? "#16a34a" : "#86efac";
          const lineColor = isPrimary ? "#15803d" : "#22c55e";
          const lineWidth = isPrimary ? 2.4 : 1.6;
          const fillOpacity = isPrimary ? 0.25 : 0.18;

          map!.addSource(sourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              geometry: p.geom,
              properties: { isPrimary: isPrimary, label: p.label ?? "" }
            }
          });
          map!.addLayer({
            id: `${sourceId}-fill`,
            type: "fill",
            source: sourceId,
            paint: { "fill-color": fillColor, "fill-opacity": fillOpacity }
          });
          map!.addLayer({
            id: `${sourceId}-line`,
            type: "line",
            source: sourceId,
            paint: { "line-color": lineColor, "line-width": lineWidth }
          });

          // Label con el nombre de la suerte en el centroide del polígono
          if (p.label && p.geom.type === "Polygon") {
            const ring = p.geom.coordinates[0];
            const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
            const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
            const labelEl = document.createElement("div");
            labelEl.className = isPrimary
              ? "map-parcel-label map-parcel-label-primary"
              : "map-parcel-label";
            labelEl.textContent = p.label;
            new maplibregl.Marker({ element: labelEl, anchor: "center" })
              .setLngLat([cx, cy])
              .addTo(map!);
          }
        });

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
            .addTo(map!);
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
  }, [parcelGeom, parcels, fumigationPoint, flights]);

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
