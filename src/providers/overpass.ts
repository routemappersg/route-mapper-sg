/**
 * OpenStreetMap road, gate and development data via the Overpass API.
 * Called through our Worker, which caches answers (Overpass is a free shared service).
 * Only coordinates are sent.
 */
import type { LatLng } from '../domain/types';
import type { Development, GateNode, MapArea, MapDataSource, Road, RoadClass } from './types';
import { distToBoundary } from '../resolve/geo';

interface OsmEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const ROAD: RoadClass[] = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'service',
];
const NOT_DRIVABLE = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'corridor', 'platform', 'construction', 'proposed', 'elevator', 'track']);
const VEHICLE_BARRIERS = new Set(['gate', 'lift_gate', 'sliding_gate', 'swing_gate', 'chain']);
const FOOT_BARRIERS = new Set(['kissing_gate', 'turnstile', 'full-height_turnstile', 'wicket_gate', 'stile']);

export function overpassQuery(p: LatLng, radiusM: number): string {
  const a = `(around:${Math.round(radiusM)},${p.lat.toFixed(6)},${p.lng.toFixed(6)})`;
  return `[out:json][timeout:25];(way${a}[highway];node${a}[barrier];node${a}[building=guardhouse];way${a}[building=guardhouse];way${a}[landuse=residential];);out geom tags;`;
}

const pts = (g?: { lat: number; lon: number }[]): LatLng[] => (g ?? []).map((q) => ({ lat: q.lat, lng: q.lon }));

function centroid(c: LatLng[]): LatLng {
  const n = c.length || 1;
  return { lat: c.reduce((s, p) => s + p.lat, 0) / n, lng: c.reduce((s, p) => s + p.lng, 0) / n };
}

const GATED_TAG_M = 40;

export function parseOverpass(json: unknown): MapArea {
  const els = ((json as { elements?: OsmEl[] }).elements ?? []);
  const roads: Road[] = [];
  const gates: GateNode[] = [];
  const devs: (Development & { privateTag: boolean })[] = [];

  for (const e of els) {
    const t = e.tags ?? {};
    if (e.type === 'way' && t.highway && !NOT_DRIVABLE.has(t.highway)) {
      const cls = (ROAD as string[]).includes(t.highway) ? (t.highway as RoadClass) : 'other';
      const road: Road = { id: `w${e.id}`, cls, private: ['private', 'no'].includes(t.access ?? '') || ['private', 'no'].includes(t.motor_vehicle ?? ''), coords: pts(e.geometry) };
      if (t.name) road.name = t.name;
      roads.push(road);
    } else if (t.building === 'guardhouse') {
      const position = e.type === 'node' && e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lng: e.lon } : centroid(pts(e.geometry));
      gates.push({ id: `${e.type[0]}${e.id}`, position, kind: 'guardhouse' });
    } else if (e.type === 'node' && t.barrier && e.lat !== undefined && e.lon !== undefined) {
      const footOnly = FOOT_BARRIERS.has(t.barrier) || t.motor_vehicle === 'no' || t.access === 'foot';
      if (!footOnly && !VEHICLE_BARRIERS.has(t.barrier)) continue;
      gates.push({ id: `n${e.id}`, position: { lat: e.lat, lng: e.lon }, kind: footOnly ? 'pedestrian' : 'barrier' });
    } else if (e.type === 'way' && t.landuse === 'residential') {
      const boundary = pts(e.geometry);
      if (boundary.length < 4) continue;
      const dev: Development & { privateTag: boolean } = {
        id: `w${e.id}`, boundary, gated: false,
        postals: (t['addr:postcode'] ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean),
        privateTag: t.access === 'private',
      };
      if (t.name) dev.name = t.name;
      devs.push(dev);
    }
  }

  // Gated = tagged private, or has a vehicle barrier or guardhouse on its edge.
  const developments: Development[] = devs.map(({ privateTag, ...d }) => ({
    ...d,
    gated: privateTag || gates.some((g) => g.kind !== 'pedestrian' && distToBoundary(g.position, d.boundary) <= GATED_TAG_M),
  }));
  return { roads, gates, developments };
}

export function overpassMapData(opts: { baseUrl: string; postText: (url: string, body: string) => Promise<unknown> }): MapDataSource {
  return {
    id: 'overpass',
    async around(position, radiusM) {
      return parseOverpass(await opts.postText(`${opts.baseUrl}/overpass`, overpassQuery(position, radiusM)));
    },
  };
}
