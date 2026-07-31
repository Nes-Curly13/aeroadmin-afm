"use client"

import type { Map as MlMap, Popup as MlPopup, StyleSpecification } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"
import { STATUS_META } from "@/lib/data-constants"
import type { ComplianceStatus } from "@/lib/types"

export type BaseMap = "satelite" | "hibrido" | "calles" | "topo"

export interface MapParcel {
  id: string
  name: string
  farm_name: string
  client_name: string
  area_ha: number
  status: ComplianceStatus
  geom: { type: "Polygon"; coordinates: [number, number][][] }
  centroid_lng: number
  centroid_lat: number
  events_in_range: number
  ha_in_range: number
}

export interface MapEvent {
  id: string
  lng: number
  lat: number
  parcel_id: string
  /**
   * s8.8 (2026-07-31) — campos del V0 que se muestran en el popup al
   * hacer click en el event del mapa. Si la fumigacion no tiene
   * flights asociados, lng/lat seran null y el caller deberia
   * filtrar el evento antes de renderizarlo.
   */
  executed_at: string
  area_treated_ha: number
  product: string
  volume_l: number
  operator: string
  flights_count: number
  notes: string | null
  source: "manual" | "import" | "djiscraper"
  n_matched_flights: number | null
}

/**
 * Estilos de mapa base para el geovisor.
 *
 * Sprint S8.1 (2026-07-28): reemplazamos el Esri World Imagery original
 * del V0 (services.arcgisonline.com) por EOX Sentinel-2 cloudless
 * (tiles.maps.eox.at). Razón: la red del operador bloquea los dominios
 * de Esri y Mapbox, y OSM en algunos segmentos.
 *
 * Sprint S8.7 (v2.6, 2026-07-30): selector de 4 basemaps via MapTiler
 * (https://api.maptiler.com/maps/{style}/style.json). Patrón oficial
 * MapTiler + MapLibre: `map.setStyle(url, { transformStyle })` donde
 * transformStyle preserva los sources/layers custom (parcels, events)
 * al cambiar de basemap. Ver:
 *   - https://docs.maptiler.com/sdk-js/examples/change-map-styles/
 *   - https://docs.maptiler.com/map-styles/  (lista completa)
 *   - https://docs.maptiler.com/gl-style-specification/sources/
 *
 * Si NEXT_PUBLIC_MAPTILER_KEY NO está definida, fallback a EOX 2024
 * (10m) para satélite y OSM para calles (sólo 2 opciones en el toggle).
 *
 * Sources: clave del API key en env (NUNCA hardcodear). Dominios
 * permitidos en CSP: next.config.ts (img-src + connect-src).
 */
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY || ""
export const USE_MAPTILER = MAPTILER_KEY.length > 0

/** Estilos MapTiler (vector). Documentados en https://docs.maptiler.com/map-styles/ */
const MAPTILER_STYLE_URLS: Record<BaseMap, string> = {
  satelite: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`,
  hibrido: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
  calles: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
  topo: `https://api.maptiler.com/maps/outdoor/style.json?key=${MAPTILER_KEY}`,
}

/** Fallback sin key MapTiler: EOX Sentinel-2 cloudless 2024 + OSM. */
const EOX_TILE_URL =
  "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"
const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf"

const FALLBACK_STYLES: Record<BaseMap, StyleSpecification> = {
  satelite: {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      eox: {
        type: "raster",
        tiles: [EOX_TILE_URL],
        tileSize: 256,
        maxzoom: 14,
        attribution:
          "Sentinel-2 cloudless 2024 &copy; <a href=\"https://eox.at\" target=\"_blank\" rel=\"noopener\">EOX</a>",
      },
    },
    layers: [{ id: "eox", type: "raster", source: "eox" }],
  },
  // hibrido + topo en fallback se renderizan igual que satélite (EOX)
  // porque sin MapTiler no hay labels ni curvas de nivel. La UI los
  // oculta cuando USE_MAPTILER=false (ver geovisor-client.tsx).
  hibrido: {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      eox: {
        type: "raster",
        tiles: [EOX_TILE_URL],
        tileSize: 256,
        maxzoom: 14,
        attribution:
          "Sentinel-2 cloudless 2024 &copy; <a href=\"https://eox.at\" target=\"_blank\" rel=\"noopener\">EOX</a>",
      },
    },
    layers: [{ id: "eox", type: "raster", source: "eox" }],
  },
  calles: {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
  topo: {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
}

/** IDs de sources y layers custom que el transformStyle debe preservar. */
const CUSTOM_SOURCE_IDS = new Set(["parcels", "events"])
const CUSTOM_LAYER_PREFIXES = ["parcels-", "events-"]

/** Filter helper: ¿es un source/layer custom que el transformStyle debe preservar? */
function isCustomSource(id: string): boolean {
  return CUSTOM_SOURCE_IDS.has(id)
}
function isCustomLayer(layer: { id?: string }): boolean {
  return typeof layer.id === "string" && CUSTOM_LAYER_PREFIXES.some((p) => layer.id!.startsWith(p))
}

function parcelsToFeatures(parcels: MapParcel[]) {
  return {
    type: "FeatureCollection" as const,
    features: parcels.map((p) => ({
      type: "Feature" as const,
      id: Number(p.id.replace(/\D/g, "")),
      geometry: p.geom,
      properties: {
        id: p.id,
        name: p.name,
        farm: p.farm_name,
        client: p.client_name,
        area: p.area_ha,
        status: p.status,
        color: STATUS_META[p.status].color,
        events: p.events_in_range,
        ha: p.ha_in_range,
      },
    })),
  }
}

/** s8.8 (2026-07-31): helper para escapar HTML en campos user-provided
 *  (product, operator, notes) antes de inyectarlos en el popup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function eventsToFeatures(events: MapEvent[]) {
  // Jitter determinista para que los eventos de una misma parcela no se apilen.
  // s8.8 (2026-07-31): incluye todos los campos del V0 en properties
  // para que el popup pueda leerlos via map.queryRenderedFeatures()
  // sin necesidad de un Map<id, event> en memoria.
  return {
    type: "FeatureCollection" as const,
    features: events.map((e, i) => {
      const a = (i % 12) * ((Math.PI * 2) / 12)
      const r = 0.00035 + (i % 4) * 0.00022
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [e.lng + Math.cos(a) * r, e.lat + Math.sin(a) * r],
        },
        properties: {
          id: e.id,
          parcel_id: e.parcel_id,
          executed_at: e.executed_at,
          area_treated_ha: e.area_treated_ha,
          product: e.product,
          volume_l: e.volume_l,
          operator: e.operator,
          flights_count: e.flights_count,
          notes: e.notes,
          source: e.source,
          n_matched_flights: e.n_matched_flights,
        },
      }
    }),
  }
}

interface GeoMapProps {
  parcels: MapParcel[]
  events: MapEvent[]
  showParcels: boolean
  showEvents: boolean
  showLabels: boolean
  baseMap: BaseMap
  selectedId: string | null
  onSelect: (id: string | null) => void
  /**
   * s8.8 (2026-07-31) — id del event seleccionado (popup abierto).
   * Cuando se setea, GeoMap muestra un popup MapLibre anclado al
   * punto. Cuando se setea a null, el popup se cierra.
   */
  selectedEventId?: string | null
  onSelectEvent?: (id: string | null) => void
}

export function GeoMap({
  parcels,
  events,
  showParcels,
  showEvents,
  showLabels,
  baseMap,
  selectedId,
  onSelect,
  selectedEventId = null,
  onSelectEvent,
}: GeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect
  const selectEventRef = useRef(onSelectEvent)
  selectEventRef.current = onSelectEvent
  const popupRef = useRef<MlPopup | null>(null)

  useEffect(() => {
    let map: MlMap | null = null
    let cancelled = false

    async function init() {
      const maplibregl = await import("maplibre-gl")
      if (cancelled || !containerRef.current) return

      // Style inicial: URL de MapTiler si hay key, sino objeto local (EOX).
      // MapLibre acepta tanto URL como objeto en `style`.
      const initialStyle = USE_MAPTILER
        ? MAPTILER_STYLE_URLS.satelite
        : FALLBACK_STYLES.satelite

      map = new maplibregl.Map({
        container: containerRef.current,
        style: initialStyle,
        center: [-76.31, 3.47],
        zoom: 10.2,
        attributionControl: { compact: true },
      })
      mapRef.current = map
      // S8.6 (v2.5.3) debug: exponer el map a window para que
      // los tests e2e puedan inspeccionar source/layers via
      // map.querySourceFeatures / queryRenderedFeatures. Inocuo
      // en prod (solo expone la misma instancia que vive en mapRef).
      ;(window as unknown as { __afmMap?: unknown }).__afmMap = map
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-left")

      map.on("load", () => {
        if (!map) return
        map.addSource("parcels", { type: "geojson", data: parcelsToFeatures([]) })
        map.addSource("events", { type: "geojson", data: eventsToFeatures([]) })

        map.addLayer({
          id: "parcels-fill",
          type: "fill",
          source: "parcels",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": 0.42,
          },
        })
        map.addLayer({
          id: "parcels-line",
          type: "line",
          source: "parcels",
          paint: {
            "line-color": ["get", "color"],
            "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3.5, 1.4],
            "line-opacity": 0.95,
          },
        })
        map.addLayer({
          id: "parcels-label",
          type: "symbol",
          source: "parcels",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "rgba(20,30,20,0.85)",
            "text-halo-width": 1.4,
          },
        })
        map.addLayer({
          id: "events-circle",
          type: "circle",
          source: "events",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.2, 13, 4, 16, 6.5],
            "circle-color": "#f5e839",
            "circle-opacity": 0.85,
            "circle-stroke-color": "rgba(32,33,37,0.7)",
            "circle-stroke-width": 0.6,
          },
        })

        map.on("click", "parcels-fill", (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined
          if (id) selectRef.current(id)
        })
        // s8.8 (2026-07-31): click en un event (fumigacion) abre el popup
        // con el detalle. El id del event se pasa al padre via onSelectEvent.
        map.on("click", "events-circle", (e) => {
          const props = e.features?.[0]?.properties
          if (props && selectEventRef.current) {
            selectEventRef.current(String(props.id))
          }
        })
        map.on("click", (e) => {
          const hits = map?.queryRenderedFeatures(e.point, { layers: ["parcels-fill", "events-circle"] })
          if (!hits || hits.length === 0) {
            selectRef.current(null)
            if (selectEventRef.current) selectEventRef.current(null)
          }
        })
        map.on("mouseenter", "events-circle", () => {
          if (map) map.getCanvas().style.cursor = "pointer"
        })
        map.on("mouseleave", "events-circle", () => {
          if (map) map.getCanvas().style.cursor = ""
        })
        map.on("mouseenter", "parcels-fill", () => {
          if (map) map.getCanvas().style.cursor = "pointer"
        })
        map.on("mouseleave", "parcels-fill", () => {
          if (map) map.getCanvas().style.cursor = ""
        })

        setReady(true)
      })
    }

    init()
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Datos
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource("parcels") as { setData?: (d: unknown) => void } | undefined
    src?.setData?.(parcelsToFeatures(parcels))
  }, [parcels, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource("events") as { setData?: (d: unknown) => void } | undefined
    src?.setData?.(eventsToFeatures(events))
  }, [events, ready])

  // Visibilidad de capas
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.setLayoutProperty("parcels-fill", "visibility", showParcels ? "visible" : "none")
    map.setLayoutProperty("parcels-line", "visibility", showParcels ? "visible" : "none")
    map.setLayoutProperty("parcels-label", "visibility", showParcels && showLabels ? "visible" : "none")
    map.setLayoutProperty("events-circle", "visibility", showEvents ? "visible" : "none")
  }, [showParcels, showEvents, showLabels, ready])

  // s8.8 (2026-07-31): sincronizar el popup MapLibre con selectedEventId.
  // Cuando se setea un id, buscamos el feature en el source "events",
  // creamos un popup MapLibre con HTML, y lo mostramos anclado al
  // punto. Cuando es null, removemos el popup.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // Cierra el popup previo si existe
    if (popupRef.current) {
      popupRef.current.remove()
      popupRef.current = null
    }
    if (!selectedEventId) return
    const event = events.find((e) => e.id === selectedEventId)
    if (!event || event.lng == null || event.lat == null) return
    ;(async () => {
      const maplibregl = await import("maplibre-gl")
      const date = new Date(event.executed_at)
      const dateLabel = isNaN(date.getTime())
        ? event.executed_at
        : date.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Bogota" })
      const areaLabel = event.area_treated_ha.toFixed(2)
      const volumeLabel = event.volume_l.toFixed(1)
      const product = event.product || "Sin producto"
      const operator = event.operator || "Sin asignar"
      const matchInfo = event.n_matched_flights != null
        ? `<div class="event-popup__row"><span class="event-popup__lbl">Flights asociados</span><span class="event-popup__val">${event.n_matched_flights}</span></div>`
        : ""
      const notesHtml = event.notes
        ? `<div class="event-popup__notes">${escapeHtml(event.notes)}</div>`
        : ""
      const html = `
        <div class="event-popup">
          <div class="event-popup__head">
            <span class="event-popup__date">${dateLabel}</span>
            <span class="event-popup__src">${event.source}</span>
          </div>
          <div class="event-popup__row"><span class="event-popup__lbl">Producto</span><span class="event-popup__val">${escapeHtml(product)}</span></div>
          <div class="event-popup__row"><span class="event-popup__lbl">Área tratada</span><span class="event-popup__val">${areaLabel} ha</span></div>
          <div class="event-popup__row"><span class="event-popup__lbl">Volumen</span><span class="event-popup__val">${volumeLabel} L</span></div>
          <div class="event-popup__row"><span class="event-popup__lbl">Operador</span><span class="event-popup__val">${escapeHtml(operator)}</span></div>
          ${matchInfo}
          ${notesHtml}
          <a class="event-popup__link" href="/parcelas/${event.parcel_id}">Ver hoja de vida de la parcela →</a>
        </div>
      `
      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: "320px",
        offset: 12,
        className: "event-popup-container",
      })
        .setLngLat([event.lng, event.lat])
        .setHTML(html)
        .addTo(map)
      popupRef.current = popup
      popup.on("close", () => {
        if (selectEventRef.current) selectEventRef.current(null)
      })
    })()
  }, [selectedEventId, events, ready])

  // Basemap
  //
  // S8.7 (v2.6) — Dos paths segun si hay MapTiler key:
  //   - USE_MAPTILER: `map.setStyle(url, { transformStyle })`. El transformStyle
  //     preserva los sources/layers custom (parcels, events) inyectandolos
  //     en el nextStyle antes de que se aplique. Patron oficial MapTiler.
  //   - Fallback: multi-source (addSource + setLayoutProperty) con EOX + OSM.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    if (USE_MAPTILER) {
      const styleUrl = MAPTILER_STYLE_URLS[baseMap]
      // map.setStyle reemplaza TODAS las sources/layers. El transformStyle
      // se ejecuta antes de aplicar el nuevo style; ahi re-inyectamos nuestros
      // parcels/events. El source "parcels" mantiene su data porque es la
      // misma referencia Map source object (no se recrea).
      map.setStyle(styleUrl, {
        transformStyle: (previousStyle, nextStyle) => {
          // previousStyle puede ser undefined en el primer setStyle
          // (antes del primer load event). En ese caso, no hay nada
          // custom que preservar.
          const preservedSources: Record<string, unknown> = {}
          const preservedLayers: unknown[] = []
          if (previousStyle) {
            for (const [id, source] of Object.entries(previousStyle.sources ?? {})) {
              if (isCustomSource(id)) preservedSources[id] = source
            }
            for (const layer of previousStyle.layers ?? []) {
              if (isCustomLayer(layer as { id?: string })) preservedLayers.push(layer)
            }
          }
          return {
            ...nextStyle,
            sources: { ...(nextStyle.sources ?? {}), ...preservedSources },
            // Las custom layers van al final para que se dibujen encima del basemap.
            layers: [...(nextStyle.layers ?? []), ...preservedLayers],
          } as StyleSpecification
        },
      })
      return
    }

    // Fallback: toggle visibility de sources raster (EOX / OSM).
    // Solo aplica a "satelite" y "calles" (los otros 2 mapean al mismo source).
    const style = FALLBACK_STYLES[baseMap]
    const activeSrc = baseMap === "calles" || baseMap === "topo" ? "osm" : "eox"
    const otherSrc = activeSrc === "eox" ? "osm" : "eox"
    if (!map.getSource(activeSrc)) {
      map.addSource(activeSrc, style.sources[activeSrc] as never)
      map.addLayer({ id: activeSrc, type: "raster", source: activeSrc }, "parcels-fill")
    }
    map.setLayoutProperty(activeSrc, "visibility", "visible")
    if (map.getLayer(otherSrc)) map.setLayoutProperty(otherSrc, "visibility", "none")
  }, [baseMap, ready])

  // Selección: encuadre + resaltado
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.removeFeatureState({ source: "parcels" })
    if (!selectedId) return
    const parcel = parcels.find((p) => p.id === selectedId)
    if (!parcel) return
    map.setFeatureState({ source: "parcels", id: Number(parcel.id.replace(/\D/g, "")) }, { selected: true })
    map.flyTo({ center: [parcel.centroid_lng, parcel.centroid_lat], zoom: 14.6, duration: 900 })
  }, [selectedId, parcels, ready])

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" aria-label="Mapa de parcelas de caña" role="application" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted">
          <span className="font-mono text-xs text-muted-foreground">Cargando cartografía…</span>
        </div>
      )}
    </div>
  )
}
