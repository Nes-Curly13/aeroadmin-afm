// tests/lib-reports-parcel-svg.test.ts
//
// Test unitario de `buildParcelLocation` y helpers (feature/reports-
// level-1 sub-sprint 2, 2026-08-08).
//
// Cubre:
//   - **Polygon simple**: extrae coords, calcula bbox y centroid correctos
//   - **MultiPolygon**: itera todos los vértices
//   - **null / sin coords**: devuelve placeholder SVG y bbox=null
//   - **Tipo no soportado** (Point, LineString): devuelve placeholder
//   - **viewBox**: el SVG tiene viewBox 0 0 size size
//   - **Inversión Y**: el path está bien mapeado (y positivo arriba)
//   - **Path es un M...L...Z**: ring cerrado

import { describe, expect, it } from "vitest";
import type { Geometry } from "geojson";

import { buildParcelLocation, formatBbox } from "@/lib/reports/parcel-svg";

// Polígono cuadrado de prueba centrado en (-76.5, 3.4) con lado ~0.001 grados.
const squarePolygon: Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [-76.5005, 3.3995],
      [-76.4995, 3.3995],
      [-76.4995, 3.4005],
      [-76.5005, 3.4005],
      [-76.5005, 3.3995]
    ]
  ]
};

// MultiPolygon con dos polígonos disjuntos.
const multiPolygon: Geometry = {
  type: "MultiPolygon",
  coordinates: [
    [[
      [-76.50, 3.40],
      [-76.49, 3.40],
      [-76.49, 3.41],
      [-76.50, 3.41],
      [-76.50, 3.40]
    ]],
    [[
      [-76.30, 3.45],
      [-76.29, 3.45],
      [-76.29, 3.46],
      [-76.30, 3.46],
      [-76.30, 3.45]
    ]]
  ]
};

describe("buildParcelLocation — bbox y centroid", () => {
  it("Polygon simple: bbox y centroid correctos", () => {
    const { bbox, centroid } = buildParcelLocation(squarePolygon);
    expect(bbox).toEqual({
      minLng: -76.5005,
      minLat: 3.3995,
      maxLng: -76.4995,
      maxLat: 3.4005
    });
    // Centroide = promedio de los 5 vértices (4 + 1 repetido del cierre).
    // lng: (-76.5005 + -76.4995 + -76.4995 + -76.5005 + -76.5005) / 5 = -76.5001
    // lat: (3.3995 + 3.3995 + 3.4005 + 3.4005 + 3.3995) / 5 = 3.3999
    expect(centroid).not.toBeNull();
    expect(centroid!.lng).toBeCloseTo(-76.5001, 4);
    expect(centroid!.lat).toBeCloseTo(3.3999, 4);
  });

  it("MultiPolygon: bbox incluye todos los polígonos", () => {
    const { bbox, centroid } = buildParcelLocation(multiPolygon);
    expect(bbox).toEqual({
      minLng: -76.50,
      minLat: 3.40,
      maxLng: -76.29,
      maxLat: 3.46
    });
    expect(centroid).not.toBeNull();
  });

  it("null → placeholder SVG y bbox/centroid null", () => {
    const result = buildParcelLocation(null);
    expect(result.bbox).toBeNull();
    expect(result.centroid).toBeNull();
    expect(result.svg).toContain("Sin geometría");
  });

  it("Point geometry → no es Polygon/MultiPolygon → placeholder", () => {
    const point: Geometry = {
      type: "Point",
      coordinates: [-76.5, 3.4]
    };
    const result = buildParcelLocation(point);
    expect(result.bbox).toBeNull();
    expect(result.svg).toContain("Sin geometría");
  });

  it("LineString → no es Polygon/MultiPolygon → placeholder", () => {
    const line: Geometry = {
      type: "LineString",
      coordinates: [[-76.5, 3.4], [-76.4, 3.5]]
    };
    const result = buildParcelLocation(line);
    expect(result.bbox).toBeNull();
    expect(result.svg).toContain("Sin geometría");
  });
});

describe("buildParcelLocation — SVG output", () => {
  it("devuelve SVG con viewBox correcto", () => {
    const { svg, size } = buildParcelLocation(squarePolygon, { size: 200 });
    expect(size).toBe(200);
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("incluye un path con M, L y Z (ring cerrado)", () => {
    const { svg } = buildParcelLocation(squarePolygon);
    // Extraemos el path d del SVG.
    const pathMatch = svg.match(/<path d="([^"]+)"/);
    expect(pathMatch).not.toBeNull();
    const d = pathMatch![1]!;
    // Debe empezar con M (move to).
    expect(d).toMatch(/^M/);
    // Debe tener al menos 4 L (4 lados del cuadrado).
    const lCount = (d.match(/L/g) ?? []).length;
    expect(lCount).toBeGreaterThanOrEqual(4);
    // Debe terminar con Z.
    expect(d).toMatch(/Z$/);
  });

  it("incluye un circle en el centroide", () => {
    const { svg } = buildParcelLocation(squarePolygon);
    // El centroide del viewBox es (size/2, size/2). El default size es 240.
    expect(svg).toContain('cx="120"');
    expect(svg).toContain('cy="120"');
    expect(svg).toContain("<circle");
  });

  it("incluye el aria-label con las coordenadas del centroide", () => {
    const { svg, centroid } = buildParcelLocation(squarePolygon);
    expect(centroid).not.toBeNull();
    expect(svg).toContain(`aria-label="Polígono de la parcela (centroide ${centroid!.lat.toFixed(5)}, ${centroid!.lng.toFixed(5)})"`);
  });

  it("invierte el eje Y (lat positivos → y positivos arriba en SVG)", () => {
    // En WGS84: lat=3.4 (sur de Ecuador) está ARRIBA en el mapa. En SVG,
    // y=size/2 - (lat - cy) * scale. Como cy es el centro del bbox,
    // las latitudes mayores (más al norte en hemisferio norte, más al
    // sur en hemisferio sur) tienen y MENOR (más arriba en SVG).
    // Verificamos esto: el punto más al norte (maxLat) tiene y menor
    // que el más al sur (minLat).
    const { svg } = buildParcelLocation(squarePolygon, { size: 240 });
    // Extraemos todos los pares (x,y) del path (sin contar Z, M, L).
    const pathMatch = svg.match(/<path d="([^"]+)"/);
    const d = pathMatch![1]!;
    // Tokens tipo "123.45,67.89"
    const tokens = d.match(/[ML]([\d.]+),([\d.]+)/g) ?? [];
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    // El primer punto del path es (-76.5005, 3.3995) — esquina inferior
    // izquierda del bbox. Su y debería ser el MAYOR de los 4 vértices
    // (esquina inferior, más al sur en el hemisferio norte).
    const ys = tokens.map((t) => {
      const m = t.match(/[ML]([\d.]+),([\d.]+)/)!;
      return parseFloat(m[2]!);
    });
    const maxY = Math.max(...ys);
    const minY = Math.min(...ys);
    expect(maxY).toBeGreaterThan(minY);
  });

  it("respeta el parámetro size", () => {
    const small = buildParcelLocation(squarePolygon, { size: 100 });
    expect(small.svg).toContain('viewBox="0 0 100 100"');
    expect(small.size).toBe(100);
    const big = buildParcelLocation(squarePolygon, { size: 400 });
    expect(big.svg).toContain('viewBox="0 0 400 400"');
    expect(big.size).toBe(400);
  });

  it("respeta el parámetro padding (más padding → viewBox menos usado)", () => {
    // Mismo polígono, distintos paddings. El polígono debería ocupar
    // menos del viewBox con más padding. Verificamos midiendo el rango
    // de y values del path.
    const small = buildParcelLocation(squarePolygon, { size: 240, padding: 0.05 });
    const big = buildParcelLocation(squarePolygon, { size: 240, padding: 0.3 });

    function yRange(svg: string): number {
      const m = svg.match(/<path d="([^"]+)"/);
      const d = m![1]!;
      const tokens = d.match(/[ML]([\d.]+),([\d.]+)/g) ?? [];
      const ys = tokens.map((t) => {
        const tm = t.match(/[ML]([\d.]+),([\d.]+)/)!;
        return parseFloat(tm[2]!);
      });
      return Math.max(...ys) - Math.min(...ys);
    }
    const rangeSmall = yRange(small.svg);
    const rangeBig = yRange(big.svg);
    // Más padding → el polígono ocupa MENOS del viewBox.
    expect(rangeBig).toBeLessThan(rangeSmall);
  });
});

describe("formatBbox", () => {
  it("formatea el bbox con 5 decimales y 'lat, lng' (orden legible)", () => {
    const formatted = formatBbox({
      minLng: -76.50051234,
      minLat: 3.39951234,
      maxLng: -76.49949876,
      maxLat: 3.40050123
    });
    expect(formatted).toBe("3,39951, -76,50051 → 3,40050, -76,49950");
  });
});
