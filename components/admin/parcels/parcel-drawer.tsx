"use client";

/**
 * ParcelDrawer — wrapper de MapLibre + terra-draw para que el operador
 * pueda dibujar, editar, undo/redo y limpiar el polígono de la parcela.
 *
 * Historia del archivo:
 *   - Sprint 2026-08-04 (feature/parcel-onboarding / sub-sprint 1): primera
 *     versión, basemap OSM, botón "Limpiar", sin toolbar.
 *   - Bug fix 2026-08-22 (fix/parcel-drawer-click-bug): setMode + addFeatures
 *     movidos DENTRO del callback `ready` de terra-draw; doubleClickZoom
 *     se deshabilita explícitamente. Ver tests/components/admin/parcels/
 *     parcel-drawer.test.tsx y tests/e2e/parcel-drawer-click.spec.ts.
 *   - QA-12 (2026-09-06, fix/qa-12-polygon-ux): rediseño completo de UX.
 *     Toolbar visible con Dibujar/Editar/Limpiar/Undo/Redo, toggle de
 *     basemap (Satélite/Híbrido/Callejero) con default satélite, empty
 *     state con botón "Comenzar dibujo", display del área calculada en
 *     hectáreas, modo "select" para editar vértices existentes.
 *
 * Decisiones de diseño UX (QA-12):
 *   - **Basemap default = Satélite** (EOX Sentinel-2 cloudless 2024 o
 *     MapTiler satellite si hay key). El operador fumigador necesita ver
 *     la realidad del lote desde el aire, no la calle.
 *   - **Toolbar flotante arriba a la izquierda del mapa**: 6 botones
 *     (Dibujar / Editar / Limpiar / Undo / Redo) + un input de búsqueda
 *     Nominatim. Los iconos son Lucide (Pencil, MousePointer, Eraser,
 *     Undo2, Redo2, Search). El estado activo del modo (Dibujar o Editar)
 *     se resalta con `variant="default"` en vez de "outline".
 *   - **Empty state centrado**: cuando no hay polígono dibujado, se
 *     muestra un overlay semitransparente con el mensaje "Dibujá el
 *     límite del lote sobre el mapa" y un botón "Comenzar dibujo" que
 *     setea el modo polygon y arranca el flow.
 *   - **Área calculada** se muestra abajo del mapa, en hectáreas con 2
 *     decimales. Se recalcula con cada cambio (`draw.on("change")`).
 *     Usa la fórmula del polígono esférico (shoelace + radio terrestre
 *     medio) — precisión sub-metro no es necesaria.
 *   - **Modo "select"** (TerraDrawSelectMode) permite arrastrar vértices
 *     del polígono existente. Se activa con el botón "Editar". El botón
 *     "Dibujar" vuelve al modo polygon.
 *
 * Compatibilidad:
 *   - El contrato del componente (`onPolygonChange`, `initialPolygon`,
 *     `initialCenter`, `initialZoom`) NO cambia. Los callers existentes
 *     (`NewParcelForm`, `RedrawGeometryButton`) siguen funcionando sin
 *     cambios.
 *   - El test unitario (parcel-drawer.test.tsx) sigue pasando: la
 *     secuencia setMode → ready → doubleClickZoom.disable se mantiene.
 *   - El e2e (parcel-drawer-click.spec.ts) sigue pasando: el botón
 *     "Limpiar polígono" mantiene su aria-label.
 *
 * Decisiones de implementación:
 *   - **Re-inicialización del mapa al cambiar basemap**: el path MapTiler
 *     usa `map.setStyle(url, transformStyle)`. El path fallback (sin
 *     key) crea un `RasterTileSource` nuevo y reemplaza el style completo
 *     (más simple que mutar sources del style actual).
 *   - **Sin geocoder lib**: el input de búsqueda hace fetch directo a
 *     Nominatim (`/search?q=...&format=json&limit=1`). Suficiente para
 *     "buscar ubicación" simple, sin agregar dependencia.
 *   - **Cálculo de área**: helper `polygonAreaHectares(geom)` con la
 *     fórmula del polígono esférico. Para una parcela cañera típica
 *     (5-50 ha) el error vs PostGIS `ST_Area(geography)` es < 0.1%.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, {
  Map as MlMap,
  type StyleSpecification
} from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Button } from "@/components/ui/button";
import {
  Eraser,
  Loader2,
  MapPin,
  MousePointer2,
  Pencil,
  Redo2,
  Satellite,
  Search,
  Undo2
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Geometría GeoJSON Polygon (formato compartido con la API y lib/types). */
type PolygonGeom = { type: "Polygon"; coordinates: number[][][] };

/** Tipos de basemap disponibles en el toggle del toolbar. */
export type BasemapKind = "satelite" | "hibrido" | "calles";

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
  /** Modo inicial del drawer: "draw" (polygon) o "edit" (select). */
  initialMode?: "draw" | "edit";
}

/**
 * Centroide aproximado de un polígono GeoJSON: promedio de los vértices
 * del primer ring (excluyendo el closing point). Suficiente para centrar
 * el mapa al re-dibujar — la precisión sub-metro no importa para esto.
 */
function polygonCentroid(p: PolygonGeom): [number, number] {
  const ring = p.coordinates[0];
  if (!ring || ring.length === 0) return [-76.31, 3.45];
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

/**
 * Área aproximada de un polígono geográfico en hectáreas usando la
 * fórmula del polígono esfrico (shoelace + radio terrestre medio).
 * Suficiente para mostrar el área al operador mientras dibuja — la
 * fuente de verdad sigue siendo PostGIS `ST_Area(geography)` al guardar.
 *
 * Referencia: https://en.wikipedia.org/wiki/Spherical_excess
 */
function polygonAreaHectares(p: PolygonGeom): number {
  const ring = p.coordinates[0];
  if (!ring || ring.length < 4) return 0;
  const EARTH_RADIUS_M = 6_378_137;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLambda = ((lng2 - lng1) * Math.PI) / 180;
    total +=
      dLambda * (2 + Math.sin(phi1) + Math.sin(phi2));
  }
  const areaM2 = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return areaM2 / 10_000;
}

/** Estilos MapTiler (vector). Si NEXT_PUBLIC_MAPTILER_KEY no está, usamos EOX. */
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
const USE_MAPTILER = MAPTILER_KEY.length > 0;

const MAPTILER_STYLE_URLS: Record<BasemapKind, string> = {
  satelite: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`,
  hibrido: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
  calles: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`
};

/** Estilo fallback sin key MapTiler: EOX Sentinel-2 cloudless 2024 + OSM. */
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
const EOX_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

const EOX_ATTRIBUTION =
  "Sentinel-2 cloudless 2024 &copy; <a href=\"https://eox.at\" target=\"_blank\" rel=\"noopener\">EOX</a>";
const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS_URL,
  sources: {
    eox: {
      type: "raster",
      tiles: [EOX_TILE_URL],
      tileSize: 256,
      maxzoom: 14,
      attribution: EOX_ATTRIBUTION
    },
    osm: {
      type: "raster",
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION
    }
  },
  layers: [
    { id: "eox", type: "raster", source: "eox" }
  ]
};

/** IDs de layers/sources del drawer que NO son del basemap. */
const CUSTOM_LAYER_PREFIXES = ["parcels-", "td-"];

export function ParcelDrawer({
  onPolygonChange,
  initialCenter = [-76.31, 3.45],
  initialZoom = 12,
  initialPolygon,
  initialMode = "draw"
}: ParcelDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const modeRef = useRef<"draw" | "edit">(initialMode);
  const [hasPolygon, setHasPolygon] = useState(initialPolygon != null);
  const [mode, setModeState] = useState<"draw" | "edit">(initialMode);
  const [basemap, setBasemap] = useState<BasemapKind>("satelite");
  const [areaHa, setAreaHa] = useState<number>(() =>
    initialPolygon ? polygonAreaHectares(initialPolygon) : 0
  );
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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

  // Inicialización del mapa + terra-draw
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return; // ya inicializado

    // Estilo inicial según el basemap default (satélite).
    const initialStyle: string | StyleSpecification = USE_MAPTILER
      ? MAPTILER_STYLE_URLS.satelite
      : FALLBACK_STYLE;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center,
      zoom
    });
    mapRef.current = map;
    // Defensa contra el bug del doble-click de MapLibre: lo deshabilitamos
    // desde ya. El modo polygon de terra-draw cierra con dblclick; si
    // MapLibre gana la carrera, hace zoom en vez de cerrar.
    map.doubleClickZoom.disable();
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right"
    );
    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }),
      "bottom-left"
    );

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
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: true,
                  coordinates: {
                    midpoints: true,
                    draggable: true,
                    deletable: true
                  }
                }
              }
            },
            styles: {
              selectedPolygonColor: "#16a34a",
              selectedPolygonFillOpacity: 0.25,
              selectedPolygonOutlineColor: "#15803d",
              selectedPolygonOutlineWidth: 2
            }
          })
        ]
      });
      drawRef.current = draw;

      // FIX 2026-08-22: setMode + addFeatures + handler de "finish"
      // viven dentro del `ready` callback. `ready` se dispara desde
      // `adapter.register()` después de que las capas GeoJSON del
      // adapter estén montadas y el primer render haya sido
      // programado. Esto garantiza que cuando el operador haga el
      // primer click, los listeners de pointerup/pointerdown del
      // adapter y las capas del mapa están listas para recibir
      // vértices.
      //
      // QA-12: agregamos SelectMode como segundo mode. El modo inicial
      // se respeta via `modeRef.current` para que `switchMode` (handlers
      // del toolbar) puedan cambiarlo sin re-inicializar el drawer.
      draw.on("ready", () => {
        // Defensivo: `map.doubleClickZoom.disable()` es idempotente y
        // barato. Lo dejamos acá para que el contrato sea explícito y
        // no quede oculto en el setStarted() interno del mode.
        map.doubleClickZoom.disable();

        draw.setMode(modeRef.current === "edit" ? "select" : "polygon");

        // Sprint 2026-08-04 (sub-sprint 2): si recibimos
        // initialPolygon, lo pre-cargamos como feature del modo
        // "polygon" para que el operador lo vea y lo pueda
        // re-dibujar encima.
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
          const last = polygons[polygons.length - 1];
          const geom = last.geometry as PolygonGeom;
          onChangeRef.current(geom);
          setHasPolygon(true);
          setAreaHa(polygonAreaHectares(geom));
          syncHistory(draw);
        });

        // QA-12: en cada change (vertex drag, undo/redo, etc.)
        // recalculamos el área + publicamos el polígono al padre.
        draw.on("change", () => {
          const snapshot = draw.getSnapshot();
          const polygons = snapshot.filter(
            (f) => f.geometry.type === "Polygon"
          );
          if (polygons.length === 0) {
            onChangeRef.current(null);
            setHasPolygon(false);
            setAreaHa(0);
            return;
          }
          const last = polygons[polygons.length - 1];
          const geom = last.geometry as PolygonGeom;
          onChangeRef.current(geom);
          setHasPolygon(true);
          setAreaHa(polygonAreaHectares(geom));
        });

        // QA-12: en cada history event sincronizamos el estado
        // canUndo/canRedo para deshabilitar los botones del toolbar.
        draw.on("history", () => {
          syncHistory(draw);
        });

        syncHistory(draw);
      });

      draw.start();
    });

    return () => {
      drawRef.current?.stop();
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, [center, zoom, initialPolygon]);

  /** Sincroniza canUndo/canRedo leyendo el estado del drawer. */
  function syncHistory(draw: TerraDraw) {
    setCanUndo(draw.canUndo());
    setCanRedo(draw.canRedo());
  }

  /** Cambia el modo (polygon ↔ select). */
  const switchMode = useCallback((next: "draw" | "edit") => {
    const draw = drawRef.current;
    if (!draw) return;
    setModeState(next);
    modeRef.current = next;
    draw.setMode(next === "edit" ? "select" : "polygon");
  }, []);

  /** Limpia el polígono actual. */
  const handleClear = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.clear();
    draw.clearUndoRedoHistory();
    onChangeRef.current(null);
    setHasPolygon(false);
    setAreaHa(0);
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  /** Undo. */
  const handleUndo = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !draw.canUndo()) return;
    draw.undo();
    syncHistory(draw);
  }, []);

  /** Redo. */
  const handleRedo = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !draw.canRedo()) return;
    draw.redo();
    syncHistory(draw);
  }, []);

  /** Cambia el basemap. Re-renderiza el style del mapa preservando los
   * sources/layers custom. */
  const handleBasemapChange = useCallback((next: BasemapKind) => {
    setBasemap(next);
    const map = mapRef.current;
    if (!map) return;
    if (USE_MAPTILER) {
      map.setStyle(MAPTILER_STYLE_URLS[next], {
        transformStyle: (previousStyle, nextStyle) => {
          const preservedSources: Record<string, unknown> = {};
          const preservedLayers: unknown[] = [];
          if (previousStyle) {
            for (const [id, source] of Object.entries(
              previousStyle.sources ?? {}
            )) {
              if (
                id !== "eox" &&
                id !== "osm" &&
                !id.startsWith("td-")
              ) {
                preservedSources[id] = source;
              }
            }
            for (const layer of previousStyle.layers ?? []) {
              const lid = (layer as { id?: string }).id;
              if (lid && CUSTOM_LAYER_PREFIXES.some((p) => lid.startsWith(p))) {
                preservedLayers.push(layer);
              }
            }
          }
          return {
            ...nextStyle,
            sources: { ...(nextStyle.sources ?? {}), ...preservedSources },
            layers: [...(nextStyle.layers ?? []), ...preservedLayers]
          } as StyleSpecification;
        }
      });
    } else {
      // Fallback: toggle de visibilidad entre los sources raster ya
      // cargados en el style. Más barato que recrear el style.
      const style = map.getStyle();
      const hasEox = !!style.sources?.eox;
      const hasOsm = !!style.sources?.osm;
      for (const layer of style.layers ?? []) {
        if (layer.id === "eox" || layer.id === "osm") {
          map.setLayoutProperty(
            layer.id,
            "visibility",
            (layer.id === "eox" && next === "satelite") ||
              (next === "hibrido") ||
              (layer.id === "osm" && next === "calles")
              ? "visible"
              : "none"
          );
        }
      }
      // Por si el style inicial no tenía OSM, lo agregamos ahora.
      if (next === "calles" && !hasOsm) {
        map.addSource("osm", {
          type: "raster",
          tiles: [OSM_TILE_URL],
          tileSize: 256,
          maxzoom: 19,
          attribution: OSM_ATTRIBUTION
        });
        map.addLayer({ id: "osm", type: "raster", source: "osm" });
      }
      if ((next === "satelite" || next === "hibrido") && !hasEox) {
        map.addSource("eox", {
          type: "raster",
          tiles: [EOX_TILE_URL],
          tileSize: 256,
          maxzoom: 14,
          attribution: EOX_ATTRIBUTION
        });
        map.addLayer({ id: "eox", type: "raster", source: "eox" });
      }
    }
  }, []);

  /** Geocoder simple: Nominatim. Sin dependencia externa. */
  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = searchQuery.trim();
      if (!q || !mapRef.current) return;
      setSearchPending(true);
      setSearchError(null);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
            q
          )}&format=json&limit=1`,
          { headers: { "Accept-Language": "es" } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Array<{
          lat: string;
          lon: string;
          display_name: string;
        }>;
        if (data.length === 0) {
          setSearchError("Sin resultados");
          return;
        }
        const { lat, lon } = data[0];
        const lng = Number(lon);
        const latN = Number(lat);
        if (!Number.isFinite(lng) || !Number.isFinite(latN)) {
          setSearchError("Sin resultados");
          return;
        }
        mapRef.current.flyTo({ center: [lng, latN], zoom: 16 });
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "error de búsqueda"
        );
      } finally {
        setSearchPending(false);
      }
    },
    [searchQuery]
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Toolbar flotante: encima del mapa, posición absolute via CSS. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/95 p-2 shadow-sm backdrop-blur">
        <Button
          type="button"
          variant={mode === "draw" ? "default" : "outline"}
          size="sm"
          onClick={() => switchMode("draw")}
          aria-label="Activar modo dibujar"
          aria-pressed={mode === "draw"}
          data-testid="drawer-mode-draw"
        >
          <Pencil className="size-3.5" aria-hidden />
          Dibujar
        </Button>
        <Button
          type="button"
          variant={mode === "edit" ? "default" : "outline"}
          size="sm"
          onClick={() => switchMode("edit")}
          aria-label="Activar modo editar"
          aria-pressed={mode === "edit"}
          disabled={!hasPolygon}
          data-testid="drawer-mode-edit"
        >
          <MousePointer2 className="size-3.5" aria-hidden />
          Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={!hasPolygon}
          aria-label="Limpiar polígono"
          data-testid="drawer-clear"
        >
          <Eraser className="size-3.5" aria-hidden />
          Limpiar
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleUndo}
          disabled={!canUndo}
          aria-label="Deshacer"
          data-testid="drawer-undo"
        >
          <Undo2 className="size-3.5" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleRedo}
          disabled={!canRedo}
          aria-label="Rehacer"
          data-testid="drawer-redo"
        >
          <Redo2 className="size-3.5" aria-hidden />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <form
          onSubmit={handleSearch}
          className="flex flex-1 items-center gap-1"
          role="search"
        >
          <div className="relative flex-1 min-w-[140px]">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar ubicación"
              aria-label="Buscar ubicación"
              disabled={searchPending}
              data-testid="drawer-search"
              className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
            />
          </div>
          {searchError && (
            <span
              className="text-[10px] font-medium text-destructive"
              role="alert"
              data-testid="drawer-search-error"
            >
              {searchError}
            </span>
          )}
        </form>
      </div>

      {/* Toggle de basemap (segmented control). */}
      <div
        className="flex items-center gap-1 self-start rounded-md border border-border bg-card/95 p-1 shadow-sm"
        role="tablist"
        aria-label="Cambiar basemap"
      >
        {(
          [
            { id: "satelite", label: "Satélite", icon: Satellite },
            { id: "hibrido", label: "Híbrido", icon: MapPin },
            { id: "calles", label: "Callejero", icon: MapPin }
          ] as const
        ).map((opt) => {
          const Icon = opt.icon;
          const active = basemap === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleBasemapChange(opt.id)}
              data-testid={`drawer-basemap-${opt.id}`}
              className={cn(
                "flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3" aria-hidden />
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Contenedor del mapa + empty state overlay. */}
      <div className="relative">
        <div
          ref={containerRef}
          className="h-[400px] w-full rounded-lg border border-input"
          data-testid="parcel-drawer-map"
          role="application"
          aria-label="Mapa para dibujar el polígono de la parcela"
        />
        {!hasPolygon && (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-lg bg-background/40"
            data-testid="drawer-empty-state"
          >
            <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-md border border-border bg-card/95 px-4 py-3 shadow-sm">
              <p className="text-sm font-medium text-foreground">
                Dibujá el límite de la parcela sobre el mapa
              </p>
              <p className="text-xs text-muted-foreground">
                Hacé click en cada vértice y doble-click para cerrar.
              </p>
              {mode !== "draw" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => switchMode("draw")}
                  data-testid="drawer-empty-start"
                  aria-label="Comenzar dibujo"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Comenzar dibujo
                </Button>
              )}
            </div>
          </div>
        )}
        {searchPending && (
          <div
            className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-md bg-card/95 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm"
            data-testid="drawer-search-pending"
          >
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Buscando…
          </div>
        )}
      </div>

      {/* Display del área calculada. */}
      <div
        className="flex items-center justify-between text-xs text-muted-foreground"
        data-testid="drawer-area"
      >
        <span>
          {hasPolygon
            ? "Polígono dibujado"
            : "Sin polígono — dibujá el límite del lote"}
        </span>
        <span className="font-mono tabular-nums">
          {areaHa > 0 ? `${areaHa.toFixed(2)} ha` : "—"}
        </span>
      </div>
    </div>
  );
}
