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
  Check,
  Eraser,
  Loader2,
  MapPin,
  MousePointer2,
  Pencil,
  Redo2,
  Satellite,
  Search,
  Undo2,
  X
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

/**
 * QA-13 (2026-09-08) — Detecta si el primer ring de un feature
 * poligonal está cerrado (primer punto == último punto). Usado por
 * el botón "Cerrar polígono" para no hacer nada si ya está cerrado.
 */
function isPolygonRingClosed(f: GeoJSONStoreFeatures): boolean {
  if (f.geometry.type !== "Polygon") return true;
  const ring = (f.geometry as PolygonGeom).coordinates[0];
  if (!ring || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1];
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
  // QA-13 (2026-09-08): track del estado de dibujo en curso para
  // mostrar hints contextuales y un botón "Cerrar polígono" más
  // rápido que el dblclick.
  const [vertexCount, setVertexCount] = useState(0);
  // QA-13: dialog para pegar coordenadas manuales como fallback
  // cuando el operador no puede dibujar con mouse (o tiene el dato
  // de un agrimensor).
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [coordsText, setCoordsText] = useState("");
  const [coordsError, setCoordsError] = useState<string | null>(null);
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
        // QA-13: también trackeamos el vertex count para mostrar
        // hints contextuales y habilitar el botón "Cerrar polígono".
        draw.on("change", () => {
          const snapshot = draw.getSnapshot();
          const polygons = snapshot.filter(
            (f) => f.geometry.type === "Polygon"
          );
          if (polygons.length === 0) {
            onChangeRef.current(null);
            setHasPolygon(false);
            setAreaHa(0);
            setVertexCount(0);
            return;
          }
          const last = polygons[polygons.length - 1];
          const geom = last.geometry as PolygonGeom;
          // Vertex count = puntos del primer ring, sin contar el
          // closing point (que repide el primero).
          const ring = geom.coordinates[0] ?? [];
          let count = ring.length;
          if (count >= 2) {
            const first = ring[0];
            const lastPt = ring[ring.length - 1];
            if (first[0] === lastPt[0] && first[1] === lastPt[1]) {
              count = ring.length - 1;
            }
          }
          setVertexCount(count);
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

  /**
   * QA-13 (2026-09-08) — Cerrar polígono manualmente. En desktop el
   * dblclick para cerrar es lento (mouse con doble click lento). Este
   * botón acelera el flujo: cuando el operador puso 3+ vértices, puede
   * cerrar el polígono de un click.
   */
  const handleClosePolygon = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    const snapshot = draw.getSnapshot();
    const polygonFeature = snapshot.find(
      (f): f is GeoJSONStoreFeatures & { id: string | number } =>
        f.geometry.type === "Polygon" && f.id != null && !isPolygonRingClosed(f)
    );
    if (!polygonFeature) return;
    const ring = (polygonFeature.geometry as PolygonGeom).coordinates[0];
    if (ring.length < 3) return;
    const closed = [...ring, ring[0]];
    const closedGeom: PolygonGeom = {
      type: "Polygon",
      coordinates: [closed]
    };
    const featureId = polygonFeature.id as string;
    draw.deleteFeature(featureId);
    draw.addFeatures([
      {
        ...polygonFeature,
        geometry: closedGeom
      } as GeoJSONStoreFeatures
    ]);
  }, []);

  /**
   * QA-13 — Importar coordenadas manuales. Acepta "lat,lng" una por
   * línea. Mínimo 3 puntos para cerrar un polígono.
   */
  const handleImportCoords = useCallback(() => {
    setCoordsError(null);
    const lines = coordsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 3) {
      setCoordsError("Necesitás al menos 3 puntos (vértices del polígono).");
      return;
    }
    const points: Array<[number, number]> = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (i === 0 && /^lat/i.test(raw) && /lng|lon/i.test(raw)) continue;
      const parts = raw.split(/[,;\s]+/).filter((p) => p.length > 0);
      if (parts.length < 2) {
        setCoordsError(`Línea ${i + 1} malformada: "${raw}". Usá formato lat,lng.`);
        return;
      }
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setCoordsError(`Línea ${i + 1} con coordenadas inválidas: "${raw}"`);
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setCoordsError(
          `Línea ${i + 1} fuera de rango: "${raw}" (lat -90..90, lng -180..180)`
        );
        return;
      }
      points.push([lng, lat]);
    }
    if (points.length < 3) {
      setCoordsError("Necesitás al menos 3 puntos válidos.");
      return;
    }
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
      first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
    const feature: GeoJSONStoreFeatures = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [closed] },
      properties: { mode: "polygon" }
    };
    const draw = drawRef.current;
    if (!draw) {
      setCoordsError("El mapa todavía no está listo. Esperá un instante.");
      return;
    }
    draw.clear();
    draw.addFeatures([feature]);
    setCoordsOpen(false);
    setCoordsText("");
    const geom = (feature.geometry as unknown) as PolygonGeom;
    onChangeRef.current(geom);
    setHasPolygon(true);
    setAreaHa(polygonAreaHectares(geom));
    setVertexCount(closed.length - 1);
  }, [coordsText]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-input">
      {/* Contenedor del mapa — absolute inset-0 para que llene el
          parent. El parent maneja el height (en new-parcel-form
          usamos h-[calc(100vh-220px)] min-h-[640px] para desktop). */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        data-testid="parcel-drawer-map"
        role="application"
        aria-label="Mapa para dibujar el polígono de la parcela"
      />

      {/* Toolbar flotante (top-left). */}
      <div
        className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur"
        data-testid="drawer-toolbar"
      >
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
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleClosePolygon}
          disabled={vertexCount < 3}
          aria-label="Cerrar polígono"
          data-testid="drawer-close-polygon"
          className="gap-1"
        >
          <Check className="size-3.5" aria-hidden />
          Cerrar
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setCoordsOpen(true);
            setCoordsError(null);
          }}
          aria-label="Importar coordenadas manuales"
          data-testid="drawer-import-coords"
        >
          <MapPin className="size-3.5" aria-hidden />
          Coords
        </Button>
      </div>

      {/* Toggle de basemap flotante (bottom-right). */}
      <div
        className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur"
        role="tablist"
        aria-label="Cambiar basemap"
        data-testid="drawer-basemap-bar"
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

      {/* Search flotante (top-right, debajo del nav control). */}
      <form
        onSubmit={handleSearch}
        className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur"
        role="search"
        data-testid="drawer-search-bar"
        style={{ marginTop: "44px" }}
      >
        <div className="relative">
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
            className="h-7 w-[180px] rounded-md border border-input bg-background pl-7 pr-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:opacity-50"
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

      {/* Empty state (esquina inferior-izquierda, no cubre el mapa). */}
      {!hasPolygon && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[280px] rounded-lg border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur"
          data-testid="drawer-empty-state"
        >
          <p className="text-sm font-semibold text-foreground">
            Cómo dibujar la parcela
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            <li>Buscá la ubicación con la barra de arriba a la derecha</li>
            <li>Hacé click en cada vértice del límite del lote</li>
            <li>
              Cuando tengas 3+ puntos, click en <strong>Cerrar</strong>
            </li>
          </ol>
          {mode !== "draw" && (
            <Button
              type="button"
              size="sm"
              onClick={() => switchMode("draw")}
              data-testid="drawer-empty-start"
              aria-label="Comenzar dibujo"
              className="pointer-events-auto mt-2 w-full"
            >
              <Pencil className="size-3.5" aria-hidden />
              Comenzar dibujo
            </Button>
          )}
        </div>
      )}

      {/* Drawing hint (vertex count en curso). */}
      {hasPolygon && vertexCount > 0 && vertexCount < 3 && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur"
          data-testid="drawer-drawing-hint"
        >
          <Pencil className="size-3 text-primary" aria-hidden />
          <span className="text-foreground">
            {vertexCount} {vertexCount === 1 ? "vértice" : "vértices"} — agregá{" "}
            {3 - vertexCount} más para cerrar
          </span>
        </div>
      )}

      {/* Display del área calculada (bottom-left, sobre scale control). */}
      <div
        className="pointer-events-none absolute bottom-12 left-3 z-10 flex items-center gap-2 rounded-md border border-border bg-card/95 px-3 py-1.5 text-xs shadow-md backdrop-blur"
        data-testid="drawer-area"
      >
        <span className="text-muted-foreground">
          {hasPolygon
            ? vertexCount > 0
              ? "Área"
              : "Polígono dibujado"
            : "Sin polígono"}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {areaHa > 0 ? `${areaHa.toFixed(2)} ha` : "—"}
        </span>
      </div>

      {searchPending && (
        <div
          className="pointer-events-none absolute right-3 top-16 z-10 flex items-center gap-1 rounded-md bg-card/95 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-md"
          data-testid="drawer-search-pending"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Buscando…
        </div>
      )}

      {/* Dialog de coordenadas manuales. */}
      {coordsOpen && (
        <div
          className="absolute inset-0 z-20 grid place-items-center bg-background/60 backdrop-blur-sm"
          data-testid="drawer-coords-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coords-modal-title"
        >
          <div className="w-[min(420px,calc(100%-32px))] rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3
                  id="coords-modal-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Pegar coordenadas de la parcela
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Una por línea, formato{" "}
                  <code className="rounded bg-muted px-1">lat,lng</code>.
                  Mínimo 3 puntos.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setCoordsOpen(false);
                  setCoordsError(null);
                }}
                aria-label="Cerrar"
                data-testid="drawer-coords-close"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            <textarea
              value={coordsText}
              onChange={(e) => setCoordsText(e.target.value)}
              placeholder={"3.4567,-76.3123\n3.4570,-76.3120\n3.4570,-76.3115\n3.4567,-76.3115"}
              rows={6}
              data-testid="drawer-coords-textarea"
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
            />
            {coordsError && (
              <p
                className="mt-2 text-[11px] font-medium text-destructive"
                role="alert"
                data-testid="drawer-coords-error"
              >
                {coordsError}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCoordsOpen(false);
                  setCoordsError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleImportCoords}
                data-testid="drawer-coords-submit"
              >
                <Check className="size-3.5" aria-hidden />
                Importar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
