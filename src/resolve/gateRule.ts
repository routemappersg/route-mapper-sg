/**
 * Gate rule (decision #23): a gated development is reached at its MAIN guarded vehicle gate.
 * A gate only counts if the road track confirms it: the gate sits on a road that leads from
 * a public road outside the development into the development. The main gate is the one
 * whose entrance road opens onto the most important public road; a guardhouse beats a bare
 * barrier. Routes never end on an expressway or slip road.
 */
import type { LatLng } from '../domain/types';
import type { Development, GateNode, MapArea, Road, RoadClass } from '../providers/types';
import { distToBoundary, inPolygon, nearestOnLine } from './geo';

export const BANNED_END: RoadClass[] = ['motorway', 'motorway_link', 'trunk_link'];

const RANK: Partial<Record<RoadClass, number>> = {
  trunk: 6, primary: 5, primary_link: 4, secondary: 4, secondary_link: 3,
  tertiary: 3, tertiary_link: 2, unclassified: 2, residential: 1, living_street: 1,
};

const ON_ROAD_M = 15;
const AT_BOUNDARY_M = 40;
const JOIN_M = 3;

export const isBanned = (r: Road): boolean => BANNED_END.includes(r.cls);
export const isPublic = (r: Road): boolean => !r.private && (RANK[r.cls] ?? 0) > 0;

function touches(a: Road, b: Road): boolean {
  return a.coords.some((p) => nearestOnLine(p, b.coords).d <= JOIN_M) ||
    b.coords.some((p) => nearestOnLine(p, a.coords).d <= JOIN_M);
}

/** Follow the road network from `start` and return the public road (outside `dev`) nearest the gate. */
function entranceRoad(start: Road, roads: Road[], dev: Development, gate: LatLng): { road: Road; d: number } | null {
  const usable = roads.filter((r) => !isBanned(r));
  const seen = new Set<string>([start.id]);
  const queue: Road[] = [start];
  let best: { road: Road; d: number } | null = null;
  while (queue.length) {
    const r = queue.shift()!;
    if (isPublic(r)) {
      const near = nearestOnLine(gate, r.coords);
      if (!inPolygon(near.point, dev.boundary) && (!best || near.d < best.d)) best = { road: r, d: near.d };
    }
    for (const n of usable) {
      if (!seen.has(n.id) && touches(r, n)) {
        seen.add(n.id);
        queue.push(n);
      }
    }
  }
  return best;
}

export interface GateChoice {
  gate: GateNode;
  /** Where the route ends: the point on the entrance road at the gate. */
  position: LatLng;
  accessRoad: Road;
  publicRoad: Road;
  score: number;
}

export function findMainGate(dev: Development, area: MapArea): GateChoice | null {
  let best: GateChoice | null = null;
  for (const gate of area.gates) {
    if (gate.kind === 'pedestrian') continue;
    if (distToBoundary(gate.position, dev.boundary) > AT_BOUNDARY_M) continue;
    for (const access of area.roads) {
      if (isBanned(access)) continue;
      const on = nearestOnLine(gate.position, access.coords);
      if (on.d > ON_ROAD_M) continue;
      const pub = entranceRoad(access, area.roads, dev, gate.position);
      if (!pub) continue;
      const score = (RANK[pub.road.cls] ?? 0) * 1000 + (gate.kind === 'guardhouse' ? 500 : 0) - pub.d;
      if (!best || score > best.score) {
        best = { gate, position: on.point, accessRoad: access, publicRoad: pub.road, score };
      }
    }
  }
  return best;
}

/** Nearest allowed end point on a road. Never an expressway or slip road. */
export function snapToRoad(
  p: LatLng,
  area: MapArea,
  opts: { publicOnly?: boolean; outside?: LatLng[] } = {},
): { point: LatLng; d: number; road: Road } | null {
  let best: { point: LatLng; d: number; road: Road } | null = null;
  for (const r of area.roads) {
    if (isBanned(r) || (opts.publicOnly && !isPublic(r))) continue;
    const n = nearestOnLine(p, r.coords);
    if (opts.outside && inPolygon(n.point, opts.outside)) continue;
    if (!best || n.d < best.d) best = { ...n, road: r };
  }
  return best;
}
