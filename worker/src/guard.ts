/**
 * PDPA payload guard. The Worker forwards to third parties ONLY what matches an exact allowlist:
 * a postal code, a block + street, or numeric coordinates inside Singapore. Anything else
 * (a name, a unit, a phone, an unexpected field) is rejected before it leaves the Worker.
 * This is a second wall behind the app: even a buggy or modified client cannot leak through us.
 */
import { overpassQuery } from '../../src/providers/overpass';
import { screenText } from '../../src/shared/screen';

export class Reject extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const SG = { minLat: 1.15, maxLat: 1.5, minLng: 103.55, maxLng: 104.1 };
export const inSingapore = (lat: number, lng: number): boolean =>
  lat >= SG.minLat && lat <= SG.maxLat && lng >= SG.minLng && lng <= SG.maxLng;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCoord = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && inSingapore(v[1], v[0]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function exactKeys(o: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) throw new Reject(400, `unexpected-field:${k}`);
  for (const k of required) if (!(k in o)) throw new Reject(400, `missing-field:${k}`);
}

export const MAX_STOPS = 50;

/** OneMap search: ?searchVal=<postal | block street>&returnGeom=Y&getAddrDetails=Y&pageNum=1 and nothing else. */
export function guardOneMapSearch(url: URL): string {
  const allowed: Record<string, string | null> = { searchVal: null, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' };
  for (const [k, v] of url.searchParams) {
    if (!(k in allowed)) throw new Reject(400, `unexpected-param:${k}`);
    if (allowed[k] !== null && v !== allowed[k]) throw new Reject(400, `bad-param:${k}`);
  }
  const q = url.searchParams.get('searchVal') ?? '';
  const isPostal = /^\d{6}$/.test(q);
  const isBlockStreet = /^\d{1,4}[A-Za-z]? [A-Za-z0-9 '.\-/]{2,60}$/.test(q) && screenText(q, 'reject', 80).ok;
  if (!isPostal && !isBlockStreet) throw new Reject(400, 'bad-search');
  return q;
}

/** Overpass: only our own generated query, nothing a client could smuggle text into. Returns its parameters. */
export function guardOverpass(body: string): { lat: number; lng: number; radius: number } {
  if (body.length > 1000) throw new Reject(413, 'too-large');
  const m = /\(around:(\d{1,4}),(-?\d{1,3}\.\d{6}),(-?\d{1,3}\.\d{6})\)/.exec(body);
  if (!m) throw new Reject(400, 'bad-query');
  const radius = Number(m[1]);
  const lat = Number(m[2]);
  const lng = Number(m[3]);
  if (radius < 50 || radius > 800 || !inSingapore(lat, lng)) throw new Reject(400, 'out-of-range');
  if (body !== overpassQuery({ lat, lng }, radius)) throw new Reject(400, 'query-shape');
  return { lat, lng, radius };
}

export type OrsRoute = 'matrix' | 'directions' | 'optimization';

/** Which ORS call a path is, or null. The Worker never forwards any other path. */
export function orsRouteOf(path: string): OrsRoute | null {
  if (path === '/ors/v2/matrix/driving-car') return 'matrix';
  if (path === '/ors/v2/directions/driving-car/geojson') return 'directions';
  if (path === '/ors/optimization') return 'optimization';
  return null;
}

/** Only numbers, booleans-free coordinate arrays and fixed enums are accepted. */
export function guardOrs(route: OrsRoute, body: unknown): void {
  if (!isObj(body)) throw new Reject(400, 'bad-body');
  if (route === 'matrix') {
    exactKeys(body, ['locations', 'metrics']);
    const { locations, metrics } = body;
    if (!Array.isArray(locations) || locations.length < 2 || locations.length > MAX_STOPS + 1 || !locations.every(isCoord)) throw new Reject(400, 'bad-locations');
    if (!Array.isArray(metrics) || metrics.length === 0 || !metrics.every((m) => m === 'duration' || m === 'distance')) throw new Reject(400, 'bad-metrics');
  } else if (route === 'directions') {
    exactKeys(body, ['coordinates']);
    const c = body.coordinates;
    if (!Array.isArray(c) || c.length < 2 || c.length > MAX_STOPS + 1 || !c.every(isCoord)) throw new Reject(400, 'bad-coordinates');
  } else {
    exactKeys(body, ['jobs', 'vehicles']);
    const { jobs, vehicles } = body;
    if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > MAX_STOPS) throw new Reject(400, 'bad-jobs');
    for (const j of jobs) {
      if (!isObj(j)) throw new Reject(400, 'bad-job');
      exactKeys(j, ['id', 'location', 'service']);
      if (!Number.isInteger(j.id) || (j.id as number) < 1 || (j.id as number) > MAX_STOPS + 10) throw new Reject(400, 'bad-job-id');
      if (!isCoord(j.location)) throw new Reject(400, 'bad-job-location');
      if (!isNum(j.service) || j.service < 0 || j.service > 7200) throw new Reject(400, 'bad-job-service');
    }
    if (!Array.isArray(vehicles) || vehicles.length !== 1 || !isObj(vehicles[0])) throw new Reject(400, 'bad-vehicles');
    const v = vehicles[0];
    exactKeys(v, ['id', 'profile', 'start'], ['end']);
    if (v.id !== 1 || v.profile !== 'driving-car' || !isCoord(v.start) || ('end' in v && !isCoord(v.end))) throw new Reject(400, 'bad-vehicle');
  }
}

/** Postal codes for community lookups: 6 digits, a small list. */
export function parsePostals(raw: string | null, max = MAX_STOPS): string[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || list.length > max || !list.every((p) => /^\d{6}$/.test(p))) throw new Reject(400, 'bad-postals');
  return [...new Set(list)];
}
