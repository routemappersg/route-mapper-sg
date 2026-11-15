import type { LatLng, Place, Stop } from '../domain/types';
import type { GeocodeHit, Geocoder, MapArea, MapDataSource } from '../providers/types';
import { findMainGate, snapToRoad, type GateChoice } from './gateRule';
import { inPolygon } from './geo';

/** A community-verified gate (decision #13): shared by every postal code of the development. */
export interface GateRecord {
  developmentId: string;
  name?: string;
  postals: string[];
  gate: LatLng;
  /** false = a corrected drop-off pin for a non-gated address (default true: a gated development's main gate). */
  gated?: boolean;
}

export interface GateRecords {
  byPostal(postal: string): GateRecord | undefined;
}

export function memoryGateRecords(list: GateRecord[]): GateRecords {
  const map = new Map<string, GateRecord>();
  for (const r of list) for (const p of r.postals) map.set(p, r);
  return { byPostal: (p) => map.get(p) };
}

export type ResolveFlag =
  | 'not-found' | 'postal-mismatch' | 'block-mismatch' | 'ambiguous'
  | 'confirm-address' | 'gate-unverified' | 'check-pin' | 'demo';

export interface Resolution {
  stopId: string;
  /** Where the route ends. null = could not be found; the stop is kept and flagged. */
  place: Place | null;
  building?: LatLng;
  development?: { id: string; name?: string };
  /** What the geocoder said, for display beside the user's own text (never overwrites it). */
  found?: { postal?: string; block?: string; street?: string; building?: string };
  flags: ResolveFlag[];
  source: 'community' | 'map-gate' | 'road-snap' | 'geocode-only' | 'none';
}

export interface ResolveDeps {
  geocoder: Geocoder;
  mapData: MapDataSource;
  records: GateRecords;
}

const SNAP_MAX_M = 150;
const norm = (s?: string): string => (s ?? '').trim().toUpperCase();

export class Resolver {
  /** All postal codes of one development share the same gate. */
  private readonly gateByDev = new Map<string, GateChoice | null>();

  constructor(private readonly deps: ResolveDeps, private readonly radiusM = 400) {}

  async resolve(stop: Stop): Promise<Resolution> {
    const { geocoder, mapData, records } = this.deps;
    const flags: ResolveFlag[] = [];
    let hit: GeocodeHit | null = null;

    // Only the postal code, or block + street, ever leaves the device.
    if (stop.postal) {
      hit = await geocoder.byPostal(stop.postal);
      if (hit?.postal && hit.postal !== stop.postal) flags.push('postal-mismatch');
    } else if (stop.block && stop.street) {
      const hits = (await geocoder.bySearch(stop.block, stop.street)).filter((h) => norm(h.block) === norm(stop.block));
      if (new Set(hits.map((h) => h.postal)).size > 1) flags.push('ambiguous');
      hit = hits[0] ?? null;
      if (hit) flags.push('confirm-address');
    }
    if (hit && stop.block && hit.block && norm(hit.block) !== norm(stop.block)) flags.push('block-mismatch');

    const base: Pick<Resolution, 'stopId' | 'flags'> & Partial<Resolution> = { stopId: stop.id, flags };
    if (hit) {
      base.building = hit.position;
      base.found = { postal: hit.postal, block: hit.block, street: hit.street, building: hit.building };
    }

    const postal = stop.postal ?? hit?.postal;
    const rec = postal ? records.byPostal(postal) : undefined;
    if (rec) {
      return {
        ...base,
        place: { postal, position: rec.gate, gated: rec.gated !== false, confidence: 'verified' },
        development: { id: rec.developmentId, name: rec.name },
        source: 'community',
      };
    }
    if (!hit) {
      flags.push('not-found');
      return { ...base, place: null, source: 'none' };
    }

    let area: MapArea;
    try {
      area = await mapData.around(hit.position, this.radiusM);
    } catch {
      flags.push('check-pin');
      return { ...base, place: { postal, position: hit.position, gated: false, confidence: 'guess' }, source: 'geocode-only' };
    }

    const dev = area.developments.find(
      (d) => inPolygon(hit.position, d.boundary) || (postal !== undefined && d.postals.includes(postal)),
    );
    if (dev?.gated) {
      let choice = this.gateByDev.get(dev.id);
      if (choice === undefined) {
        choice = findMainGate(dev, area);
        this.gateByDev.set(dev.id, choice);
      }
      const development = { id: dev.id, name: dev.name };
      if (choice) {
        return { ...base, development, place: { postal, position: choice.position, gated: true, confidence: 'map-data' }, source: 'map-gate' };
      }
      // Gated, but no gate passes the road-track check: end on the nearest public road outside.
      flags.push('gate-unverified');
      const snap = snapToRoad(hit.position, area, { publicOnly: true, outside: dev.boundary });
      return {
        ...base,
        development,
        place: { postal, position: snap?.point ?? hit.position, gated: true, confidence: 'guess' },
        source: snap ? 'road-snap' : 'geocode-only',
      };
    }

    const snap = snapToRoad(hit.position, area);
    if (!snap || snap.d > SNAP_MAX_M) {
      flags.push('check-pin');
      return { ...base, place: { postal, position: snap?.point ?? hit.position, gated: false, confidence: 'guess' }, source: snap ? 'road-snap' : 'geocode-only' };
    }
    return { ...base, place: { postal, position: snap.point, gated: false, confidence: 'map-data' }, source: 'road-snap' };
  }
}
