import type { LatLng } from '../domain/types';

const R = 6371008.8;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Move a point by metres east and north. */
export function offset(p: LatLng, eastM: number, northM: number): LatLng {
  return {
    lat: p.lat + (northM / R) * (180 / Math.PI),
    lng: p.lng + (eastM / (R * Math.cos(rad(p.lat)))) * (180 / Math.PI),
  };
}

/** Local flat projection in metres around `ref`; accurate at street scale. */
function xy(p: LatLng, ref: LatLng): [number, number] {
  return [rad(p.lng - ref.lng) * R * Math.cos(rad(ref.lat)), rad(p.lat - ref.lat) * R];
}

export function nearestOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; d: number } {
  const [ax, ay] = xy(a, p);
  const [bx, by] = xy(b, p);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return {
    point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) },
    d: Math.hypot(ax + t * dx, ay + t * dy),
  };
}

export function nearestOnLine(p: LatLng, coords: LatLng[]): { point: LatLng; d: number } {
  const first = coords[0];
  if (!first) return { point: p, d: Infinity };
  if (coords.length === 1) return { point: first, d: distance(p, first) };
  let best = { point: first, d: Infinity };
  for (let i = 0; i + 1 < coords.length; i++) {
    const r = nearestOnSegment(p, coords[i]!, coords[i + 1]!);
    if (r.d < best.d) best = r;
  }
  return best;
}

/** Ray-casting point-in-polygon on a closed ring. */
export function inPolygon(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

export function distToBoundary(p: LatLng, ring: LatLng[]): number {
  const first = ring[0];
  return first ? nearestOnLine(p, [...ring, first]).d : Infinity;
}
