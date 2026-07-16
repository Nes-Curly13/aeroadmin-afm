// lib/flight-plan.ts
//
// M3-M5 Track B (2026-07-17): convierte la geometría cruda de
// `dji_parcels.waypoints_geometry` (GeoJSON.MultiPoint con waypoints
// sueltos) en una geometría apta para renderizar el plan de vuelo
// como <Polyline> en Leaflet (LineString o MultiLineString).
//
// El scraper DJI entrega los waypoints como puntos sueltos en el orden
// que el planificador los generó, no necesariamente ordenados para
// visualización. La heurística:
//
//   1. Si ya viene como LineString o MultiLineString → devolver tal cual.
//   2. Si viene como MultiPoint:
//      a) Arrancamos en coordinates[0] (punto de inicio determinístico).
//      b) Aplicamos nearest-neighbor: cada paso siguiente es el punto
//         no visitado más cercano (haversine en metros).
//      c) Si la distancia al siguiente punto excede CLUSTER_GAP_METERS
//         (500m), interpretamos que es una ruta separada y abrimos
//         una nueva LineString.
//   3. MultiPoint vacío o Polygon (no lineal) → null (defensivo).
//
// Por qué nearest-neighbor en vez de "como viene del DJI": DJI entrega
// los waypoints en el orden que el operador los plantó, pero un
// plan de fumigación real los suele entregar ordenados para
// ejecución eficiente. Sin embargo, el caso real del operador
// (ver BITACORA M3-M5) ha sido que el orden no es estable entre
// versiones del plan, por lo que nearest-neighbor da una visualización
// consistente y "suficientemente buena" para inspección visual.
//
// Por qué 500m de gap: en 30s a 7m/s (velocidad típica T40), un dron
// recorre ~200m, así que gaps > 500m claramente exceden lo que un
// solo pase de fumigación puede cubrir. Tunear si aparecen planes
// legítimamente con gaps mayores (e.g. por obstáculos o por la
// topología de la sweep-direction).

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Threshold de split de clusters en metros.
 * Gaps mayores a este valor entre waypoints consecutivos se interpretan
 * como rutas separadas (abren una nueva LineString en el MultiLineString).
 * Ver JSDoc del módulo para justificación.
 */
export const CLUSTER_GAP_METERS = 500;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distancia haversine en metros entre dos puntos lng/lat.
 * Suficientemente precisa para los gaps que inspeccionamos (<15 km).
 */
function haversineMeters(a: readonly [number, number], b: readonly [number, number]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Encuentra el índice del punto más cercano (no visitado) al punto de referencia.
 * Retorna -1 si todos los puntos están visitados.
 */
function findNearest(
  ref: readonly [number, number],
  points: ReadonlyArray<readonly [number, number]>,
  visited: ReadonlyArray<boolean>
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (visited[i]) continue;
    const d = haversineMeters(ref, points[i]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Convierte la geometría cruda de waypoints en una geometría de plan
 * de vuelo apta para renderizar como <Polyline>.
 *
 * @param geom Geometría GeoJSON de `dji_parcels.waypoints_geometry`.
 *   En la práctica viene como `MultiPoint` (lo más común desde DJI),
 *   pero la función tolera `LineString` y `MultiLineString` ya lineales.
 * @returns `LineString` o `MultiLineString` si hay un plan renderizable,
 *   o `null` si la geometría es null/vacía/no-lineal.
 */
export function waypointsToFlightPlan(
  geom: GeoJSON.Geometry | null
): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (geom === null || geom === undefined) return null;

  if (geom.type === "LineString") {
    // Ya viene como plan lineal — devolver tal cual.
    return geom;
  }

  if (geom.type === "MultiLineString") {
    return geom;
  }

  if (geom.type !== "MultiPoint") {
    // Polygon, GeometryCollection, etc. — no son planes lineales.
    return null;
  }

  // GeoJSON Position es number[] pero para MultiPoint en la práctica
  // siempre viene como [lng, lat] (2D). Normalizamos a tupla estricta
  // para que las comparaciones de haversine sean type-safe.
  const rawCoords = geom.coordinates;
  if (rawCoords.length === 0) return null;
  const coords: Array<readonly [number, number]> = rawCoords.map((c) => {
    if (!Array.isArray(c) || c.length < 2) {
      throw new Error(`Invalid waypoint coordinate: ${JSON.stringify(c)}`);
    }
    return [c[0] as number, c[1] as number] as const;
  });

  // Caso especial: 1 solo waypoint → LineString de 1 coord.
  if (coords.length === 1) {
    return {
      type: "LineString",
      coordinates: [[coords[0][0], coords[0][1]]]
    };
  }

  // Nearest-neighbor con split por gap.
  const visited = new Array<boolean>(coords.length).fill(false);
  const lines: Array<Array<[number, number]>> = [[]];
  let currentLine = lines[0];
  let currentIdx = 0; // empezamos en coordinates[0]
  visited[0] = true;
  currentLine.push([coords[0][0], coords[0][1]]);

  for (let step = 1; step < coords.length; step++) {
    const nextIdx = findNearest(coords[currentIdx], coords, visited);
    if (nextIdx === -1) break; // todos visitados
    const dist = haversineMeters(coords[currentIdx], coords[nextIdx]);

    if (dist > CLUSTER_GAP_METERS) {
      // Gap grande: abrimos nueva LineString arrancando en el siguiente
      // punto (no en el actual — la ruta actual ya cerró en currentIdx).
      currentLine = [[coords[nextIdx][0], coords[nextIdx][1]]];
      lines.push(currentLine);
    } else {
      // Continuamos la misma LineString.
      currentLine.push([coords[nextIdx][0], coords[nextIdx][1]]);
    }
    visited[nextIdx] = true;
    currentIdx = nextIdx;
  }

  // Edge case: si por algún bug no se visitó ningún punto, devolver null.
  if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) {
    return null;
  }

  if (lines.length === 1) {
    return {
      type: "LineString",
      coordinates: lines[0]
    };
  }

  return {
    type: "MultiLineString",
    coordinates: lines
  };
}
