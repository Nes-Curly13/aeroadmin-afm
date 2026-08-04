"use client";

/**
 * ParcelDrawer — wrapper de MapLibre + terra-draw para que el operador
 * pueda dibujar el polígono de la parcela manualmente.
 *
 * Sprint 2026-08-04 — feature/parcel-onboarding (sub-sprint 1).
 * Update 2026-08-04 (sub-sprint 2): agregado `initialPolygon` opcional
 * para soportar el re-dibujo desde el detail page (componente
 * `RedrawGeometryButton`). Cuando se pasa, el mapa centra en el
 * centroide del polígono y pre-carga la geometría en terra-draw.
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
  type GeoJSONStoreFeatures
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, MapPin } from "lucide-react";

/** Geometría GeoJSON Polygon (formato compartido con la API y lib/types). */
type PolygonGeom = { type: "Polygon"; coordinates: number[][][] };

export interface ParcelDrawerProps {
  /** Callback con el polígono dibujado en formato GeoJSON Polygon. */
  onPolygonChange: (geom: PolygonGeom | null) => void;
  /** Coordenadas iniciales del centro del mapa [lng, lat]. Default Palmira. */
  initialCenter?: [number, number];
  /** Zoom inicial. Default 12. */
  initialZoom?: number;
  /**
   * Geometría inicial a pre-cargar en el mapa. Default `undefined` →
   * drawer arranca vacío (modo "alta nueva"). Si se pasa, se centra en
   * el centroide del polígono y se carga con `draw.addFeatures`, dejando
   * el botón "Limpiar" habilitado (el operador puede volver a empezar).
   */
  initialPolygon?: PolygonGeom | null;
}

/**
 * Centroide aproximado de un polígono GeoJSON: promedio de los vértices
 * del primer ring (excluyendo el closing point). Suficiente para centrar
 * el mapa al re-dibujar — la precisión sub-metro no importa para esto.
 */
function polygonCentroid(p: PolygonGeom): [number, number] {
  const ring = p.coordinates[0];
  if (!ring || ring.length === 0) return [-76.31, 3.45];
  // Si el último punto == primero, lo salteamos.
  const closed = ring[ring.length - 1];
  const first = ring[0];
  const pts =
    closed[0] === first[0] && closed[1] === first[1]
      ? ring.slice(0, -1)
      : ring;
  if (pts.length === 0) return [-76.31, 3.45];
  let lng = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lng += x;
    lat += y;
  }
  return [lng / pts.length, lat / pts.length];
}

export function ParcelDrawer({
  onPolygonChange,
  initialCenter = [-76.31, 3.45],
  initialZoom = 12,
  initialPolygon
}: ParcelDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [hasPolygon, setHasPolygon] = useState(initialPolygon != null);
  const onChangeRef = useRef(onPolygonChange);
  // Mantener el callback actualizado sin re-inicializar el mapa.
  useEffect(() => {
    onChangeRef.current = onPolygonChange;
  }, [onPolygonChange]);

  // Si hay initialPolygon, centramos en su centroide. Si no, usamos el
  // initialCenter que nos pasaron (default Palmira). Memoizamos para
  // que el effect de inicialización no se re-dispare en cada render.
  const { center, zoom } = useMemo(() => {
    if (initialPolygon) {
      return { center: polygonCentroid(initialPolygon), zoom: 14 };
    }
    return { center: initialCenter, zoom: initialZoom };
  }, [initialPolygon, initialCenter, initialZoom]);

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
      center,
      zoom
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

      // Sprint 2026-08-04 (sub-sprint 2): si recibimos initialPolygon,
      // lo pre-cargamos como feature del modo "polygon" para que el
      // operador lo vea y lo pueda re-dibujar encima. El addFeatures
      // requiere `properties.mode` para que terra-draw sepa qué modo
      // valida la geometría.
      if (initialPolygon) {
        const feature: GeoJSONStoreFeatures = {
          type: "Feature",
          geometry: initialPolygon,
          properties: { mode: "polygon" }
        };
        draw.addFeatures([feature]);
        onChangeRef.current(initialPolygon);
      }

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
  }, [center, zoom, initialPolygon]);

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
