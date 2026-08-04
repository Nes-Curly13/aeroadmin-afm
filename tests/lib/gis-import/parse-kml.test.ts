/**
 * tests/lib/gis-import/parse-kml.test.ts — unit tests del parser KML.
 *
 * No dependemos de un archivo .kml real: construimos strings KML en memoria
 * y los pasamos al parser. Esto cubre el happy path + 3 edge cases típicos.
 */

import { describe, it, expect } from "vitest";
import { parseKml } from "@/lib/gis-import/parse-kml";

/**
 * Helper para construir un KML mínimo con N placemarks. Cada placemark
 * tiene un nombre y un polígono (cuadrado chico). Los polígonos NO se
 * superponen.
 */
function buildKml(opts: {
  placemarks: { name: string; lng: number; lat: number; size?: number }[];
}): string {
  const size = 0.001; // ~100m en Valle del Cauca
  const placemarks = opts.placemarks
    .map((p) => {
      const s = p.size ?? size;
      const ring = [
        [p.lng, p.lat],
        [p.lng + s, p.lat],
        [p.lng + s, p.lat + s],
        [p.lng, p.lat + s],
        [p.lng, p.lat]
      ];
      return `    <Placemark>
      <name>${p.name}</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
${ring.map(([lng, lat]) => `              ${lng},${lat},0`).join("\n")}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test KML</name>
${placemarks}
  </Document>
</kml>`;
}

describe("parseKml", () => {
  it("happy path: 2 placemarks Polygon", () => {
    const kml = buildKml({
      placemarks: [
        { name: "Lote 1", lng: -76.31, lat: 3.45 },
        { name: "Lote 2", lng: -76.32, lat: 3.46 }
      ]
    });
    const result = parseKml(Buffer.from(kml, "utf8"), "test.kml");
    expect(result.format).toBe("kml");
    expect(result.features).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(result.features[0].name).toBe("Lote 1");
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(result.features[1].name).toBe("Lote 2");
  });

  it("ignora Placemarks que no son Polygon (Point, LineString)", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Un punto</name>
      <Point>
        <coordinates>-76.31,3.45,0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Lote bueno</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-76.31,3.45,0 -76.30,3.45,0 -76.30,3.46,0 -76.31,3.46,0 -76.31,3.45,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
    <Placemark>
      <name>Una línea</name>
      <LineString>
        <coordinates>-76.31,3.45,0 -76.30,3.46,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKml(Buffer.from(kml, "utf8"), "test.kml");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].name).toBe("Lote bueno");
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.some((w) => w.includes("Point"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("LineString"))).toBe(true);
  });

  it("usa fallback 'Parcela N' si el Placemark no tiene name", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-76.31,3.45,0 -76.30,3.45,0 -76.30,3.46,0 -76.31,3.46,0 -76.31,3.45,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKml(Buffer.from(kml, "utf8"), "test.kml");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].name).toBe("Parcela 1");
  });

  it("tira error con XML inválido", () => {
    const bad = Buffer.from("<kml><not closed", "utf8");
    expect(() => parseKml(bad, "bad.kml")).toThrow(/KML inválido/);
  });

  it("maneja Placemark con geometría MultiPolygon", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Lote multi</name>
      <MultiGeometry>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>-76.31,3.45,0 -76.30,3.45,0 -76.30,3.46,0 -76.31,3.46,0 -76.31,3.45,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>-76.29,3.45,0 -76.28,3.45,0 -76.28,3.46,0 -76.29,3.46,0 -76.29,3.45,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKml(Buffer.from(kml, "utf8"), "test.kml");
    // togeojson convierte MultiGeometry en 1 Feature MultiPolygon
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("MultiPolygon");
  });

  it("devuelve warning + features vacío si no hay polígonos", () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Solo un punto</name>
      <Point>
        <coordinates>-76.31,3.45,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKml(Buffer.from(kml, "utf8"), "test.kml");
    expect(result.features).toEqual([]);
    expect(result.warnings).toContain(
      "El KML no contiene polígonos importables"
    );
  });
});
