// lib/geometry.ts
//
// Helpers de geometría 2D (lng/lat) para detectar solape entre parcelas
// sin dependencias externas. Se usa en el alta manual de parcela para
// avisar si el polígono nuevo se superpone con una parcela existente
// (evitar errores de topología / duplicados en el mismo lugar).
//
// Aproximación plana (no esférica): para parcelas chicas (decenas de ha)
// el error es despreciable. Solo se miran los anillos EXTERIORES (los
// huecos no interesan para detectar solape).

export type LngLat = [number, number];
export type Ring = LngLat[];
/** [minX, minY, maxX, maxY] */
export type Bbox = [number, number, number, number];

interface GeoJsonGeometry {
  type?: string;
  coordinates?: unknown;
}

/** Anillos exteriores de un Polygon / MultiPolygon GeoJSON. */
export function geojsonOuterRings(geom: unknown): Ring[] {
  if (!geom || typeof geom !== "object") return [];
  const g = geom as GeoJsonGeometry;
  if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
    const outer = (g.coordinates as unknown[])[0];
    return Array.isArray(outer) ? [outer as Ring] : [];
  }
  if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    const rings: Ring[] = [];
    for (const poly of g.coordinates as unknown[]) {
      if (Array.isArray(poly) && Array.isArray((poly as unknown[])[0])) {
        rings.push((poly as unknown[])[0] as Ring);
      }
    }
    return rings;
  }
  return [];
}

/** Bbox de un anillo. Devuelve null si no hay puntos válidos. */
export function ringBbox(ring: Ring): Bbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [x, y] = p;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return any ? [minX, minY, maxX, maxY] : null;
}

export function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

/** True si el punto está dentro del anillo (ray casting). */
export function pointInRing(pt: LngLat, ring: Ring): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!pi || !pj) continue;
    const [xi, yi] = pi;
    const [xj, yj] = pj;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function orientation(a: LngLat, b: LngLat, c: LngLat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: LngLat, b: LngLat, c: LngLat): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  );
}

/** True si los segmentos p1p2 y p3p4 se cruzan. */
export function segmentsIntersect(
  p1: LngLat,
  p2: LngLat,
  p3: LngLat,
  p4: LngLat
): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  // Colineales tocándose
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}

/** True si dos anillos se solapan (intersección de bordes o uno dentro del otro). */
export function ringsOverlap(a: Ring, b: Ring): boolean {
  const ba = ringBbox(a);
  const bb = ringBbox(b);
  if (!ba || !bb || !bboxesOverlap(ba, bb)) return false;

  // Algún vértice de uno dentro del otro => solape (cubre contención).
  for (const p of a) {
    if (Array.isArray(p) && p.length >= 2 && pointInRing([p[0], p[1]], b)) {
      return true;
    }
  }
  for (const p of b) {
    if (Array.isArray(p) && p.length >= 2 && pointInRing([p[0], p[1]], a)) {
      return true;
    }
  }

  // Bordes que se cruzan (solape parcial sin vértices dentro).
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    if (!a1 || !a2) continue;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (!b1 || !b2) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** True si dos geometrías GeoJSON (Polygon/MultiPolygon) se solapan. */
export function geometriesOverlap(a: unknown, b: unknown): boolean {
  const ra = geojsonOuterRings(a);
  const rb = geojsonOuterRings(b);
  for (const x of ra) {
    for (const y of rb) {
      if (ringsOverlap(x, y)) return true;
    }
  }
  return false;
}
