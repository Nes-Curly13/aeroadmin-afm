// tests/lib/flight-plan.test.ts
//
// Tests para la conversión de `waypoints_geometry` (GeoJSON.MultiPoint,
// LineString o MultiLineString) a una geometría de plan de vuelo
// (LineString o MultiLineString) apta para renderizar como <Polyline>.
//
// M3-M5 Track B (2026-07-17): los planes DJI llegan como MultiPoint
// de waypoints sueltos. Para visualizar la geometría del plan
// (no solo dots), necesitamos ordenarlos y conectarlos. La heurística
// es nearest-neighbor partiendo del primer punto, con split en
// gaps > CLUSTER_GAP_METERS (default 500m) que indican rutas separadas.

import { describe, expect, it } from "vitest";

import { waypointsToFlightPlan, CLUSTER_GAP_METERS } from "@/lib/flight-plan";

/**
 * Helper: assert no-null + extrae el resultado como LineString.
 * El cast es seguro porque el caller verifica `type` primero.
 */
function asLineString(g: GeoJSON.LineString | GeoJSON.MultiLineString | null): GeoJSON.LineString {
  if (g === null) throw new Error("expected non-null");
  if (g.type !== "LineString") throw new Error(`expected LineString, got ${g.type}`);
  return g;
}

function asMultiLineString(
  g: GeoJSON.LineString | GeoJSON.MultiLineString | null
): GeoJSON.MultiLineString {
  if (g === null) throw new Error("expected non-null");
  if (g.type !== "MultiLineString") throw new Error(`expected MultiLineString, got ${g.type}`);
  return g;
}

describe("waypointsToFlightPlan", () => {
  describe("input null / vacío", () => {
    it("retorna null si la geometría es null", () => {
      expect(waypointsToFlightPlan(null)).toBeNull();
    });

    it("retorna null si la geometría es undefined", () => {
      expect(waypointsToFlightPlan(undefined as unknown as null)).toBeNull();
    });
  });

  describe("input LineString / MultiLineString (ya viene como plan)", () => {
    it("retorna la LineString tal cual sin reordenar", () => {
      const line: GeoJSON.LineString = {
        type: "LineString",
        coordinates: [
          [-76.5, 3.45],
          [-76.51, 3.451],
          [-76.52, 3.452]
        ]
      };
      expect(waypointsToFlightPlan(line)).toEqual(line);
    });

    it("retorna la MultiLineString tal cual", () => {
      const multi: GeoJSON.MultiLineString = {
        type: "MultiLineString",
        coordinates: [
          [
            [-76.5, 3.45],
            [-76.51, 3.451]
          ],
          [
            [-76.4, 3.45],
            [-76.41, 3.451]
          ]
        ]
      };
      expect(waypointsToFlightPlan(multi)).toEqual(multi);
    });
  });

  describe("input MultiPoint (caso común de DJI)", () => {
    it("3 puntos en triángulo pequeño → 1 LineString con orden nearest-neighbor", () => {
      // Triángulo cerca de Valle del Cauca, ~110-155m por lado.
      // Punto inicial = coordinates[0]; cada paso siguiente = más cercano.
      const triangle: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: [
          [-76.5, 3.45], // P0
          [-76.501, 3.4511], // P2 (≈165m de P0)
          [-76.5, 3.451] // P1 (≈111m de P0, ≈111m de P2)
        ]
      };
      const result = asLineString(waypointsToFlightPlan(triangle));
      // LineString debe tener exactamente 3 puntos.
      expect(result.coordinates).toHaveLength(3);
      // Primer punto siempre es el del input.
      expect(result.coordinates[0]).toEqual([-76.5, 3.45]);
      // La secuencia debe pasar por los 3 puntos sin repetir.
      const set = new Set(result.coordinates.map((c) => c.join(",")));
      expect(set.size).toBe(3);
      // Verificación de optimalidad: P0→P1 (111m) < P0→P2 (165m),
      // así que el segundo punto debe ser P1, no P2.
      expect(result.coordinates[1]).toEqual([-76.5, 3.451]);
      // Y el tercero cierra el triángulo.
      expect(result.coordinates[2]).toEqual([-76.501, 3.4511]);
    });

    it("2 clusters >500m aparte → MultiLineString con 2 LineStrings", () => {
      // Cluster A cerca de (-76.5, 3.45), cluster B cerca de (-76.4, 3.45).
      // Distancia entre clusters ≈ 11 km (mucho > 500m).
      // Dentro de cada cluster los puntos están a ~10m entre sí.
      const clusters: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: [
          [-76.5, 3.45], // A0
          [-76.5, 3.4501], // A1
          [-76.4, 3.45], // B0
          [-76.4, 3.4501] // B1
        ]
      };
      const result = asMultiLineString(waypointsToFlightPlan(clusters));
      // 2 LineStrings, una por cluster.
      expect(result.coordinates).toHaveLength(2);
      // Cada LineString tiene 2 puntos (no 3 — nearest neighbor nunca
      // cruza el gap > 500m entre clusters).
      for (const line of result.coordinates) {
        expect(line).toHaveLength(2);
      }
      // Cada cluster debe estar contenido en su propia LineString.
      // Cluster A: puntos con lng ≈ -76.5
      // Cluster B: puntos con lng ≈ -76.4
      const lineA = result.coordinates[0];
      const lineB = result.coordinates[1];
      // Todas las coords de lineA deben tener lng ≈ -76.5.
      for (const coord of lineA) {
        expect(coord[0]).toBeCloseTo(-76.5, 1);
      }
      // Todas las coords de lineB deben tener lng ≈ -76.4.
      for (const coord of lineB) {
        expect(coord[0]).toBeCloseTo(-76.4, 1);
      }
    });

    it("2 puntos adyacentes (<500m) → LineString simple", () => {
      const twoPoints: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: [
          [-76.5, 3.45],
          [-76.501, 3.45]
        ]
      };
      const result = asLineString(waypointsToFlightPlan(twoPoints));
      expect(result.coordinates).toHaveLength(2);
    });

    it("1 solo punto → LineString de 1 coordenada (Leaflet lo renderiza como punto)", () => {
      const single: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: [[-76.5, 3.45]]
      };
      const result = asLineString(waypointsToFlightPlan(single));
      expect(result.coordinates).toHaveLength(1);
    });

    it("MultiPoint vacío (0 coordenadas) → null (no hay plan que renderizar)", () => {
      const empty: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: []
      };
      expect(waypointsToFlightPlan(empty)).toBeNull();
    });

    it("puntos duplicados (misma coord 2 veces) → LineString los incluye ambos", () => {
      // Edge case: si DJI repite un waypoint, no lo deduplicamos —
      // preservamos la fidelidad del input.
      const dup: GeoJSON.MultiPoint = {
        type: "MultiPoint",
        coordinates: [
          [-76.5, 3.45],
          [-76.5, 3.45],
          [-76.501, 3.451]
        ]
      };
      const result = asLineString(waypointsToFlightPlan(dup));
      expect(result.coordinates).toHaveLength(3);
    });
  });

  describe("input Polygon (no esperado, defensivo)", () => {
    it("retorna null para Polygon (no es un plan lineal)", () => {
      const polygon: GeoJSON.Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [-76.5, 3.45],
            [-76.5, 3.46],
            [-76.49, 3.46],
            [-76.49, 3.45],
            [-76.5, 3.45]
          ]
        ]
      };
      // Polygon no es un plan lineal → retornamos null defensivamente
      // (los polígonos fumigados ya se renderizan con la capa 'parcels').
      expect(waypointsToFlightPlan(polygon)).toBeNull();
    });
  });

  describe("constante CLUSTER_GAP_METERS", () => {
    it("expone el threshold de split como 500m (decisión documentada)", () => {
      // 500m es un valor conservador para rutas de dron: en 30s a 7m/s
      // el dron recorre ~200m, así que gaps > 500m claramente indican
      // rutas separadas. Tunable si en el futuro se ven planes con
      // sweep-direction que produzca gaps legítimos más grandes.
      expect(CLUSTER_GAP_METERS).toBe(500);
    });
  });
});
