import type { LatLng } from '../domain/types';

export const MAX_STOPS_PER_RUN = 50;

/**
 * Split stops into `runs` groups by direction from the depot (a sweep), cutting at the
 * widest empty sector first so a cluster is not cut in half. Groups are balanced in size.
 * Returns indices into `stops`.
 */
export function splitRuns(depot: LatLng, stops: LatLng[], runs = Math.ceil(stops.length / MAX_STOPS_PER_RUN)): number[][] {
  if (runs <= 1 || stops.length === 0) return [stops.map((_, i) => i)];
  const ang = stops.map((p, i) => ({ i, a: Math.atan2(p.lat - depot.lat, (p.lng - depot.lng) * Math.cos((depot.lat * Math.PI) / 180)) }));
  ang.sort((x, y) => x.a - y.a);
  let gapAt = 0;
  let gap = -1;
  for (let k = 0; k < ang.length; k++) {
    const next = ang[(k + 1) % ang.length]!.a + (k + 1 === ang.length ? 2 * Math.PI : 0);
    const g = next - ang[k]!.a;
    if (g > gap) { gap = g; gapAt = (k + 1) % ang.length; }
  }
  const rotated = [...ang.slice(gapAt), ...ang.slice(0, gapAt)].map((x) => x.i);
  const groups: number[][] = [];
  const size = rotated.length / runs;
  for (let r = 0; r < runs; r++) groups.push(rotated.slice(Math.round(r * size), Math.round((r + 1) * size)));
  return groups;
}
