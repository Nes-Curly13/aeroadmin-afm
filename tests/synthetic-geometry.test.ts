// Tests para lib/data.ts (synthetic geometry + flight hull cascade, v2.5.5)
//
// v2.5.5 (S8.7+): `dji_parcels.spray_geom` es NULL para 1213/1213
// parcelas. La cascada de polígonos en `adaptParcel` (lib/data.ts) es:
//
//   1. spray_geometry real del scraper
//   2. ST_ConvexHull de flights fumigados (≥3 flights)  ← NUEVO v2.5.5
//   3. Buffer circular alrededor del flight centroid     ← NUEVO v2.5.5
//   4. N-gon sintetico irregular (Knuth hash)           ← MEJORADO v2.5.5
//
// Estos tests verifican (a) las funciones puras helper (syntheticPolygon,
// flightBufferPolygon, syntheticCentroid), y (b) la lógica del cascade
// re-implementada en JS puro (no se puede importar lib/data.ts directo
// porque tiene `import "server-only"` que enreda el bundler de vitest).

import { describe, it, expect } from "vitest";

// =============================================================================
// Re-implementacion de las funciones helper (en JS puro, sin server-only)
// Mantener en sync con lib/data.ts. Si los tests fallan despues de un
// cambio en lib/data.ts, es probable que la implementación real haya
// cambiado — actualizar acá.
// =============================================================================

const DEFAULT_CENTER: { lng: number; lat: number } = { lng: -76.3, lat: 3.45 };
const SYNTHETIC_REGION_DEG = 0.9;

function areaHaToRadiusDeg(areaHa: number): number {
  const ha = Math.max(areaHa, 0.5);
  const radiusM = Math.sqrt((ha * 10_000) / Math.PI);
  return Math.max(radiusM / 111_000, 0.0006);
}

function syntheticCentroid(parcelId: number): { lng: number; lat: number } {
  const hash = (parcelId * 2654435761) >>> 0;
  const lngOffset = ((hash % 10000) / 10000 - 0.5) * SYNTHETIC_REGION_DEG;
  const latOffset = (((hash >>> 16) % 10000) / 10000 - 0.5) * SYNTHETIC_REGION_DEG;
  return {
    lng: DEFAULT_CENTER.lng + lngOffset,
    lat: DEFAULT_CENTER.lat + latOffset
  };
}

function syntheticPolygon(
  center: { lng: number; lat: number },
  areaHa: number,
  parcelId: number
): { type: "Polygon"; coordinates: [number, number][][] } {
  // Cantidad de lados: 8 a 12. Usamos (id - 1) % 5 para que el rango
  // sea exactamente 0..4 (los parcel IDs reales empiezan en 1, no en 0).
  const n = 8 + ((parcelId - 1) % 5);
  const r = areaHaToRadiusDeg(areaHa);
  const aspectRatio = 0.7 + ((parcelId * 17) % 100) / 100 * 0.6;
  const perturbSeed = (parcelId * 31) >>> 8;
  const ring: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angleBase = (2 * Math.PI * i) / n;
    const angleJitter = (((perturbSeed + i * 7) % 100) / 100 - 0.5) * (Math.PI / n);
    const angle = angleBase + angleJitter;
    const radialFactor = 0.65 + (((perturbSeed + i * 13) % 100) / 100) * 0.7;
    const rActual = r * radialFactor;
    const dLng = rActual * Math.cos(angle) * aspectRatio;
    const dLat = (rActual * Math.sin(angle)) / aspectRatio;
    ring.push([center.lng + dLng, center.lat + dLat]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

function flightBufferPolygon(
  center: { lng: number; lat: number },
  areaHa: number
): { type: "Polygon"; coordinates: [number, number][][] } {
  const sides = 16;
  const r = areaHaToRadiusDeg(areaHa);
  const ring: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    ring.push([center.lng + r * Math.cos(angle), center.lat + r * Math.sin(angle)]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return { type: "Polygon", coordinates: [ring] };
}

// =============================================================================
// Tests: syntheticCentroid (sin cambios respecto a v2.5.3)
// =============================================================================

describe("syntheticCentroid", () => {
  it("produce 1213 posiciones unicas para los IDs reales de BD (1..1213)", () => {
    const ids = Array.from({ length: 1213 }, (_, i) => i + 1);
    const positions = ids.map((id) => syntheticCentroid(id));
    const unique = new Set(positions.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`));
    expect(unique.size).toBeGreaterThan(1100);
  });

  it("es determinista: misma entrada -> misma salida", () => {
    const a = syntheticCentroid(42);
    const b = syntheticCentroid(42);
    expect(a).toEqual(b);
  });

  it("IDs distintos producen posiciones distintas", () => {
    const a = syntheticCentroid(1);
    const b = syntheticCentroid(2);
    expect(`${a.lng},${a.lat}`).not.toBe(`${b.lng},${b.lat}`);
  });

  it("las posiciones caen dentro del bounding box del Valle del Cauca", () => {
    for (let id = 1; id <= 1213; id++) {
      const { lng, lat } = syntheticCentroid(id);
      expect(lng).toBeGreaterThanOrEqual(-76.75);
      expect(lng).toBeLessThanOrEqual(-75.85);
      expect(lat).toBeGreaterThanOrEqual(3.0);
      expect(lat).toBeLessThanOrEqual(3.9);
    }
  });
});

// =============================================================================
// Tests: syntheticPolygon N-gon irregular (NUEVO v2.5.5)
// =============================================================================

describe("syntheticPolygon (N-gon irregular)", () => {
  it("genera un poligono cerrado valido (primer vertice = ultimo vertice)", () => {
    const center = { lng: -76.3, lat: 3.45 };
    const poly = syntheticPolygon(center, 5, 1);
    expect(poly.type).toBe("Polygon");
    expect(poly.coordinates).toHaveLength(1);
    const ring = poly.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("genera entre 8 y 12 vertices (mas 1 repetido para cerrar el ring)", () => {
    // El ring tiene n+1 puntos (n vertices + 1 repetido).
    for (let id = 1; id <= 20; id++) {
      const poly = syntheticPolygon({ lng: 0, lat: 0 }, 5, id);
      const n = poly.coordinates[0].length - 1; // restamos el repetido
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(12);
    }
  });

  it("N depende del parcel ID de forma determinista (8 + id % 5)", () => {
    expect(syntheticPolygon({ lng: 0, lat: 0 }, 5, 1).coordinates[0].length).toBe(9); // n=8
    expect(syntheticPolygon({ lng: 0, lat: 0 }, 5, 2).coordinates[0].length).toBe(10); // n=9
    expect(syntheticPolygon({ lng: 0, lat: 0 }, 5, 5).coordinates[0].length).toBe(13); // n=12
    expect(syntheticPolygon({ lng: 0, lat: 0 }, 5, 6).coordinates[0].length).toBe(9); // n=8 (vuelve)
  });

  it("NO es un cuadrado perfecto: vertices consecutivos tienen distancias distintas al centro", () => {
    // Si fuera un cuadrado perfecto, todos los vertices estarian a la misma
    // distancia del centro (el radio). Con perturbacion, esa distancia varia.
    const center = { lng: -76.3, lat: 3.45 };
    const poly = syntheticPolygon(center, 5, 42);
    const ring = poly.coordinates[0].slice(0, -1); // sin el punto repetido
    const distances = ring.map(([lng, lat]) => Math.hypot(lng - center.lng, lat - center.lat));
    const uniqueDistances = new Set(distances.map((d) => d.toFixed(8)));
    // Esperamos al menos 4 distancias distintas (no todas iguales)
    expect(uniqueDistances.size).toBeGreaterThanOrEqual(4);
  });

  it("NO es cuadrado perfecto: los angulos no son uniformemente espaciados", () => {
    // Calculamos los angulos de cada vertice respecto al centro.
    // Si fuera regular, la diferencia entre angulos consecutivos seria 2π/n constante.
    const center = { lng: -76.3, lat: 3.45 };
    const poly = syntheticPolygon(center, 5, 42);
    const ring = poly.coordinates[0].slice(0, -1);
    const angles = ring.map(([lng, lat]) => Math.atan2(lat - center.lat, lng - center.lng));
    const gaps: number[] = [];
    for (let i = 1; i < angles.length; i++) {
      gaps.push(angles[i] - angles[i - 1]);
    }
    // Las diferencias angulares NO son todas iguales (hay jitter).
    const uniqueGaps = new Set(gaps.map((g) => g.toFixed(6)));
    expect(uniqueGaps.size).toBeGreaterThan(2);
  });

  it("el area aproximada crece con areaHa (radio mas grande)", () => {
    // Comparamos el bounding box de dos poligonos con areaHa muy distintos.
    const center = { lng: 0, lat: 0 };
    const polySmall = syntheticPolygon(center, 1, 42);
    const polyLarge = syntheticPolygon(center, 100, 42);
    const bbox = (p: { coordinates: [number, number][][] }) => {
      const ring = p.coordinates[0];
      const lngs = ring.map((c) => c[0]);
      const lats = ring.map((c) => c[1]);
      return (Math.max(...lngs) - Math.min(...lngs)) * (Math.max(...lats) - Math.min(...lats));
    };
    expect(bbox(polyLarge)).toBeGreaterThan(bbox(polySmall) * 50);
  });

  it("es determinista: misma entrada -> misma forma", () => {
    const center = { lng: -76.3, lat: 3.45 };
    const a = syntheticPolygon(center, 5, 42);
    const b = syntheticPolygon(center, 5, 42);
    expect(a).toEqual(b);
  });

  it("aspect ratio variable: el bbox no es cuadrado perfecto", () => {
    // Para algunos parcel IDs, el poligono es mas ancho en lng que alto
    // en lat (o viceversa). El aspect ratio deriva de parcelId * 17 % 100.
    // Verificamos que en una muestra haya varianza real.
    const ratios: number[] = [];
    for (let id = 1; id <= 50; id++) {
      const poly = syntheticPolygon({ lng: 0, lat: 0 }, 5, id);
      const ring = poly.coordinates[0];
      const lngs = ring.map((c) => c[0]);
      const lats = ring.map((c) => c[1]);
      const w = Math.max(...lngs) - Math.min(...lngs);
      const h = Math.max(...lats) - Math.min(...lats);
      ratios.push(w / h);
    }
    const minRatio = Math.min(...ratios);
    const maxRatio = Math.max(...ratios);
    // Esperamos varianza: minRatio < 0.6, maxRatio > 1.5 (no todos ~1.0)
    expect(minRatio).toBeLessThan(0.6);
    expect(maxRatio).toBeGreaterThan(1.5);
  });
});

// =============================================================================
// Tests: flightBufferPolygon (NUEVO v2.5.5)
// =============================================================================

describe("flightBufferPolygon (buffer circular para 1-2 flights)", () => {
  it("genera un circulo cerrado (17 puntos: 16 lados + 1 repetido)", () => {
    const poly = flightBufferPolygon({ lng: 0, lat: 0 }, 5);
    expect(poly.coordinates[0]).toHaveLength(17);
    expect(poly.coordinates[0][0]).toEqual(poly.coordinates[0][16]);
  });

  it("es aproximadamente un circulo: vertices equidistantes del centro", () => {
    const center = { lng: -76.3, lat: 3.45 };
    const poly = flightBufferPolygon(center, 5);
    const ring = poly.coordinates[0].slice(0, -1);
    const distances = ring.map(([lng, lat]) => Math.hypot(lng - center.lng, lat - center.lat));
    const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
    // Todos los vertices estan a ±5% del promedio (es un circulo, no un N-gon irregular)
    for (const d of distances) {
      expect(Math.abs(d - avg) / avg).toBeLessThan(0.05);
    }
  });

  it("el radio escala con areaHa", () => {
    const center = { lng: 0, lat: 0 };
    // Usamos areas grandes (10 y 1000) para evitar el piso de
    // areaHaToRadiusDeg (0.5ha mínimo). 1000/10 = 100x area → radio 10x.
    const poly1 = flightBufferPolygon(center, 10);
    const poly2 = flightBufferPolygon(center, 1000);
    const radius = (p: { coordinates: [number, number][][] }) => {
      const ring = p.coordinates[0];
      return Math.hypot(ring[0][0] - center.lng, ring[0][1] - center.lat);
    };
    expect(radius(poly2) / radius(poly1)).toBeGreaterThan(9);
    expect(radius(poly2) / radius(poly1)).toBeLessThan(11);
  });
});

// =============================================================================
// Tests: cascade de adaptParcel (RE-IMPLEMENTADO en JS puro)
// =============================================================================
// Misma logica que adaptParcel en lib/data.ts pero standalone, para testear
// la cascada sin importar server-only.

type ParcelFixture = {
  id: number;
  spray_geometry: GeoJSON.Geometry | null;
  declared_area_ha: number | null;
};

type FlightHullFixture = {
  flightCount: number;
  centroid: { lng: number; lat: number };
  hullGeometry: GeoJSON.Polygon | null;
} | null;

function adaptParcelCascade(p: ParcelFixture, flightHull: FlightHullFixture) {
  const areaHa = p.declared_area_ha ?? 0;
  let center: { lng: number; lat: number };
  let geom: { type: "Polygon"; coordinates: [number, number][][] };

  if (p.spray_geometry?.type === "Polygon" || p.spray_geometry?.type === "MultiPolygon") {
    // Acepta Polygon o MultiPolygon (replica lib/data.ts s8.8+).
    // Para MultiPolygon, toma el primer anillo del primer polígono.
    const ring: [number, number][] =
      p.spray_geometry.type === "Polygon"
        ? ((p.spray_geometry.coordinates[0] ?? []) as [number, number][])
        : ((p.spray_geometry.coordinates[0]?.[0] ?? []) as [number, number][]);
    const sum = ring.reduce(
      (acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }),
      { lng: 0, lat: 0 }
    );
    center = { lng: sum.lng / ring.length, lat: sum.lat / ring.length };
    geom = p.spray_geometry as { type: "Polygon"; coordinates: [number, number][][] };
  } else if (flightHull?.hullGeometry) {
    center = flightHull.centroid;
    geom = flightHull.hullGeometry as { type: "Polygon"; coordinates: [number, number][][] };
  } else if (flightHull) {
    center = flightHull.centroid;
    geom = flightBufferPolygon(center, areaHa);
  } else {
    center = syntheticCentroid(p.id);
    geom = syntheticPolygon(center, areaHa, p.id);
  }

  return { center, geom };
}

describe("adaptParcel cascade (v2.5.5)", () => {
  it("caso 1: usa spray_geometry real cuando existe", () => {
    // Cuadrado unitario: el ring tiene 5 puntos (4 vértices + 1 repetido
    // para cerrar). El centroide es el promedio de los 5 puntos, así
    // que el primer vértice (que aparece 2 veces) tiene doble peso.
    //   lng = (-76.5*2 + -76.49*2 + -76.5) / 5 = -382.48 / 5 = -76.496
    //   lat = (3.4*2 + 3.41*2 + 3.4) / 5 = 17.02 / 5 = 3.404
    const realGeom: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[-76.5, 3.4], [-76.5, 3.41], [-76.49, 3.41], [-76.49, 3.4], [-76.5, 3.4]]]
    };
    const { center, geom } = adaptParcelCascade(
      { id: 1, spray_geometry: realGeom, declared_area_ha: 5 },
      null
    );
    expect(geom).toBe(realGeom);
    expect(center.lng).toBeCloseTo(-76.496, 3);
    expect(center.lat).toBeCloseTo(3.404, 3);
  });

  it("caso 2: usa hull real de flights cuando hay >=3 flights", () => {
    const hull: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[-76.31, 3.45], [-76.30, 3.45], [-76.30, 3.46], [-76.31, 3.46], [-76.31, 3.45]]]
    };
    const flightHull: FlightHullFixture = {
      flightCount: 5,
      centroid: { lng: -76.305, lat: 3.455 },
      hullGeometry: hull
    };
    const { center, geom } = adaptParcelCascade(
      { id: 42, spray_geometry: null, declared_area_ha: 5 },
      flightHull
    );
    expect(geom).toBe(hull);
    expect(center).toEqual({ lng: -76.305, lat: 3.455 });
  });

  it("caso 3: usa buffer circular cuando hay 1-2 flights", () => {
    const flightHull: FlightHullFixture = {
      flightCount: 1,
      centroid: { lng: -76.305, lat: 3.455 },
      hullGeometry: null
    };
    const { center, geom } = adaptParcelCascade(
      { id: 42, spray_geometry: null, declared_area_ha: 5 },
      flightHull
    );
    // Centro viene del flight centroid (no del synthetic)
    expect(center).toEqual({ lng: -76.305, lat: 3.455 });
    // Geom es un circulo de 17 puntos (16 lados + 1 repetido)
    expect(geom.coordinates[0]).toHaveLength(17);
    expect(geom.coordinates[0][0]).toEqual(geom.coordinates[0][16]);
  });

  it("caso 4: usa N-gon sintetico cuando no hay ni geometria real ni flights", () => {
    const { center, geom } = adaptParcelCascade(
      { id: 42, spray_geometry: null, declared_area_ha: 5 },
      null
    );
    // Centro viene del synthetic (Knuth hash)
    expect(center).toEqual(syntheticCentroid(42));
    // Geom es un N-gon sintetico (8-12 vertices + 1 repetido)
    const n = geom.coordinates[0].length - 1;
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThanOrEqual(12);
  });

  it("precedencia: spray_geometry real gana sobre hull", () => {
    const realGeom: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
    };
    const flightHull: FlightHullFixture = {
      flightCount: 5,
      centroid: { lng: -76.305, lat: 3.455 },
      hullGeometry: {
        type: "Polygon",
        coordinates: [[[-76.31, 3.45], [-76.30, 3.45], [-76.30, 3.46], [-76.31, 3.46], [-76.31, 3.45]]]
      }
    };
    const { geom } = adaptParcelCascade(
      { id: 1, spray_geometry: realGeom, declared_area_ha: 5 },
      flightHull
    );
    expect(geom).toBe(realGeom);
  });

  it("precedencia: hull gana sobre buffer (incluso con flightCount bajo)", () => {
    // Edge case: si flightHull.hullGeometry existe (aunque sea un poligono
    // degenerado), gana sobre el buffer. Esto no debería pasar en la
    // práctica (la query SQL solo devuelve hull si count >= 3), pero el
    // cascade es defensivo: si hay hull, lo usa.
    const hull: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[-76.31, 3.45], [-76.30, 3.45], [-76.30, 3.46], [-76.31, 3.46], [-76.31, 3.45]]]
    };
    const flightHull: FlightHullFixture = {
      flightCount: 1,
      centroid: { lng: -76.305, lat: 3.455 },
      hullGeometry: hull
    };
    const { geom } = adaptParcelCascade(
      { id: 1, spray_geometry: null, declared_area_ha: 5 },
      flightHull
    );
    expect(geom).toBe(hull);
  });
});
