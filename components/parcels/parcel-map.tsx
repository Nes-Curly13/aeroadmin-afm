"use client"

import type { Map as MlMap } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

interface FlightPoint {
  id: string
  lng: number
  lat: number
  pilot: string
}

export function ParcelMap({
  geom,
  color,
  flights,
}: {
  geom: { type: "Polygon"; coordinates: [number, number][][] }
  color: string
  flights: FlightPoint[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let map: MlMap | null = null
    let cancelled = false

    async function init() {
      const maplibregl = await import("maplibre-gl")
      if (cancelled || !containerRef.current) return

      const ring = geom.coordinates[0]
      const lngs = ring.map((c) => c[0])
      const lats = ring.map((c) => c[1])
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ]

      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            // Sprint S8.1: Esri reemplazado por EOX Sentinel-2 cloudless
            // (la red del operador bloquea services.arcgisonline.com).
            // EOX es público (CC-BY) y no requiere API key.
            eox: {
              type: "raster",
              tiles: [
                "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"
              ],
              tileSize: 256,
              maxzoom: 14,
              attribution:
                "Sentinel-2 cloudless 2020 &copy; <a href=\"https://eox.at\" target=\"_blank\" rel=\"noopener\">EOX</a>",
            },
          },
          layers: [{ id: "eox", type: "raster", source: "eox" }],
        },
        bounds,
        fitBoundsOptions: { padding: 34 },
        attributionControl: { compact: true },
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")

      map.on("load", () => {
        if (!map) return
        map.addSource("parcel", {
          type: "geojson",
          data: { type: "Feature", geometry: geom, properties: {} },
        })
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel",
          paint: { "fill-color": color, "fill-opacity": 0.35 },
        })
        map.addLayer({
          id: "parcel-line",
          type: "line",
          source: "parcel",
          paint: { "line-color": color, "line-width": 2.4 },
        })
        map.addSource("flights", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: flights.map((f, i) => {
              const a = (i % 14) * ((Math.PI * 2) / 14)
              const r = 0.0004 + (i % 5) * 0.00018
              return {
                type: "Feature" as const,
                geometry: {
                  type: "Point" as const,
                  coordinates: [f.lng + Math.cos(a) * r, f.lat + Math.sin(a) * r],
                },
                properties: { pilot: f.pilot },
              }
            }),
          },
        })
        map.addLayer({
          id: "flights-circle",
          type: "circle",
          source: "flights",
          paint: {
            "circle-radius": 3.6,
            "circle-color": "#f5e839",
            "circle-opacity": 0.9,
            "circle-stroke-color": "rgba(32,33,37,0.7)",
            "circle-stroke-width": 0.6,
          },
        })
        setReady(true)
      })
    }

    init()
    return () => {
      cancelled = true
      map?.remove()
      setReady(false)
    }
  }, [geom, color, flights])

  return (
    <div className="relative h-64 overflow-hidden rounded-lg border border-border sm:h-80">
      <div ref={containerRef} className="size-full" role="application" aria-label="Geometría de la parcela" />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-muted">
          <span className="font-mono text-xs text-muted-foreground">Cargando geometría…</span>
        </div>
      )}
    </div>
  )
}
