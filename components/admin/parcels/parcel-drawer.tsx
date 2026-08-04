"use client";

/**
 * ParcelDrawer — wrapper de MapLibre + terra-draw para que el operador
 * pueda dibujar el polígono de la parcela manualmente.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 *
 * Funcionalidad:
 *   - Mapa centrado en Valle del Cauca (Palmira como default — 3.45, -76.31)
 *   - Modo "Polígono" activo: el operador hace click en los vértices
 *     y doble-click para cerrar
 *   - Botón "Limpiar" para borrar el polígono actual y empezar de nuevo
 *   - Cuando hay un polígono dibujado, llama a `onPolygonChange(geojson)`
 *     con la geometría GeoJSON
 *
 * Decisión de implementación:
 *   - El mapa se monta UNA sola vez con basemap OSM (gratis, no requiere
 *     key MapTiler, suficiente para el caso de uso). Si el operador
 *     quiere satélite, se puede agregar un toggle después.
 *   - Usamos terra-draw con el adapter MapLibre oficial.
 *   - El `onPolygonChange` solo se llama cuando hay un polígono (no en
 *     cada click) — se dispara en el evento `finish` y en el `change`
 *     cuando el polígono se completa.
 *   - Validación laxa: cualquier polígono de 3+ vértices se acepta. La
 *     validación `ST_IsValid` no la hacemos server-side (decisión QA).
 *
 * Testing: este componente es client-side puro, no se testea con vitest
 * unitario (necesita MapLibre + DOM real). Se cubre con e2e (Playwright).
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawPolygonMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, MapPin } from "lucide-react";

export interface ParcelDrawerProps {
  /** Callback con el polígono dibujado en formato GeoJSON Polygon. */
  onPolygonChange: (geom: { type: "Polygon"; coordinates: number[][][] } | null) => void;
  /** Coordenadas iniciales del centro del mapa [lng, lat]. Default Palmira. */
  initialCenter?: [number, number];
  /** Zoom inicial. Default 12. */
  initialZoom?: number;
}

export function ParcelDrawer({
  onPolygonChange,
  initialCenter = [-76.31, 3.45],
  initialZoom = 12
}: ParcelDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [hasPolygon, setHasPolygon] = useState(false);
  const onChangeRef = useRef(onPolygonChange);
  // Mantener el callback actualizado sin re-inicializar el mapa.
  useEffect(() => {
    onChangeRef.current = onPolygonChange;
  }, [onPolygonChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // ya inicializado

    // OSM raster style (gratis, no requiere API key).
    // Suficiente para un basemap en contexto de "dibujar un polígono".
    // El operador puede usar el slider de zoom para orientarse.
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm"
          }
        ]
      },
      center: initialCenter,
      zoom: initialZoom
    });
    mapRef.current = map;

    // terra-draw con un solo mode (Polygon).
    // El adapter se monta DESPUÉS de que el mapa esté listo.
    map.on("load", () => {
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: {
              fillColor: "#16a34a",
              fillOpacity: 0.2,
              outlineColor: "#15803d",
              outlineWidth: 2,
              closingPointColor: "#15803d"
            }
          })
        ]
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode("polygon");

      // Cuando el operador termina de dibujar, mandamos el polígono.
      draw.on("finish", () => {
        const snapshot = draw.getSnapshot();
        const polygons = snapshot.filter(
          (f) => f.geometry.type === "Polygon"
        );
        if (polygons.length === 0) return;
        // Tomamos el último polígono dibujado.
        const last = polygons[polygons.length - 1];
        const geom = last.geometry as {
          type: "Polygon";
          coordinates: number[][][];
        };
        onChangeRef.current(geom);
        setHasPolygon(true);
      });
    });

    return () => {
      drawRef.current?.stop();
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [initialCenter, initialZoom]);

  function handleClear() {
    if (!drawRef.current) return;
    drawRef.current.clear();
    onChangeRef.current(null);
    setHasPolygon(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <MapPin className="inline size-3.5" /> Hacé click en los vértices del lote. Doble-click para cerrar el polígono.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!hasPolygon}
          aria-label="Limpiar polígono"
        >
          <Eraser className="size-3.5" aria-hidden />
          Limpiar
        </Button>
      </div>
      <div
        ref={containerRef}
        className="h-[400px] w-full rounded-lg border border-input"
        data-testid="parcel-drawer-map"
        role="application"
        aria-label="Mapa para dibujar el polígono de la parcela"
      />
    </div>
  );
}
