import { describe, expect, it } from 'vitest';
import type { Stop } from '../src/domain/types';
import type { GeocodeHit, Geocoder, MapDataSource } from '../src/providers/types';
import { findMainGate } from '../src/resolve/gateRule';
import { distance, nearestOnLine } from '../src/resolve/geo';
import { memoryGateRecords, Resolver, type GateRecord } from '../src/resolve/resolver';
import { area, at, blocks, estate } from './resolve.scenario';

const calls: string[] = [];

function geocoder(overrides: Record<string, GeocodeHit | null> = {}, search: GeocodeHit[] = []): Geocoder {
  return {
    id: 'mock',
    async byPostal(postal) {
      calls.push(`postal:${postal}`);
      if (postal in overrides) return overrides[postal] ?? null;
      const p = blocks[postal];
      return p ? { postal, block: '1', position: p } : null;
    },
    async bySearch(block, street) {
      calls.push(`search:${block} ${street}`);
      return search;
    },
  };
}

const mapData: MapDataSource = {
  id: 'mock',
  async around(p, r) {
    calls.push(`around:${p.lat.toFixed(5)},${p.lng.toFixed(5)},${r}`);
    return area;
  },
};

const stop = (postal: string | undefined, extra: Partial<Stop> = {}): Stop => ({
  id: `s-${postal ?? 'x'}`, status: 'pending', flags: [], ...(postal ? { postal } : {}), ...extra,
});

const resolver = (records: GateRecord[] = [], g = geocoder()) =>
  new Resolver({ geocoder: g, mapData, records: memoryGateRecords(records) });

const roadById = (id: string) => area.roads.find((r) => r.id === id)!;

describe('gate rule: gated development', () => {
  it('picks the main guardhouse on the public road, not the rear barrier or the pedestrian gate', () => {
    const choice = findMainGate(estate, area)!;
    expect(choice.gate.id).toBe('guardhouse');
    expect(choice.publicRoad.id).toBe('main-public');
    expect(choice.accessRoad.id).toBe('main-access');
  });

  it('routes all four postal codes of the development to the same main gate, within 30 m', async () => {
    const r = resolver();
    const results = await Promise.all(['677721', '677722', '677723', '677724'].map((p) => r.resolve(stop(p))));
    const first = results[0]!.place!.position;
    for (const res of results) {
      expect(res.source).toBe('map-gate');
      expect(res.place?.gated).toBe(true);
      expect(res.place?.confidence).toBe('map-data');
      expect(res.development?.name).toBe('Synthetic Residences');
      expect(res.flags).toEqual([]);
      expect(distance(res.place!.position, first)).toBeLessThan(0.01);
    }
    expect(distance(first, at(108, 5))).toBeLessThanOrEqual(30);
  });

  it('never ends on the expressway or slip road even though they are nearer the blocks', async () => {
    const res = await resolver().resolve(stop('677721'));
    expect(nearestOnLine(res.place!.position, roadById('expressway').coords).d).toBeGreaterThan(50);
    expect(nearestOnLine(res.place!.position, roadById('slip').coords).d).toBeGreaterThan(50);
  });

  it('prefers a community-verified gate over map data', async () => {
    const res = await resolver([{ developmentId: 'dev-estate', postals: ['677721'], gate: at(101, -18) }]).resolve(stop('677721'));
    expect(res.source).toBe('community');
    expect(res.place?.confidence).toBe('verified');
  });

  it('a barrier with no road track to a public road is not trusted: flags gate-unverified and ends on the public road outside', async () => {
    const res = await resolver().resolve(stop('660650'));
    expect(res.flags).toContain('gate-unverified');
    expect(res.place?.confidence).toBe('guess');
    expect(res.place?.gated).toBe(true);
    expect(nearestOnLine(res.place!.position, roadById('locked-public').coords).d).toBeLessThan(1);
  });
});

describe('non-gated buildings', () => {
  it('snap to the nearest allowed road, skipping an expressway only 5 m away', async () => {
    const res = await resolver().resolve(stop('600100'));
    expect(res.source).toBe('road-snap');
    expect(res.place?.gated).toBe(false);
    expect(nearestOnLine(res.place!.position, roadById('hdb-expressway').coords).d).toBeGreaterThan(30);
  });
});

describe('never silently change or drop a stop', () => {
  it('flags a postal code the geocoder changed (the RouteXL 692128 -> 690128 case)', async () => {
    const g = geocoder({ '692128': { postal: '690128', block: '128', street: 'Plantation Crescent', position: at(450, -60) } });
    const res = await resolver([], g).resolve(stop('692128', { block: '128B' }));
    expect(res.flags).toEqual(expect.arrayContaining(['postal-mismatch', 'block-mismatch']));
    expect(res.found?.postal).toBe('690128');
  });

  it('keeps a stop the geocoder cannot find, flagged not-found', async () => {
    const res = await resolver([], geocoder({ '999999': null })).resolve(stop('999999'));
    expect(res.place).toBeNull();
    expect(res.flags).toEqual(['not-found']);
  });

  it('no postal code: block + street search, only an exact block match is accepted, and must be confirmed', async () => {
    const g = geocoder({}, [
      { postal: '680570', block: '570', street: 'Hougang Street 51', position: at(450, -60) },
      { postal: '680571', block: '571', street: 'Hougang Street 51', position: at(460, -60) },
    ]);
    const res = await resolver([], g).resolve(stop(undefined, { block: '570', street: 'Hougang Street 51' }));
    expect(res.flags).toContain('confirm-address');
    expect(res.found?.postal).toBe('680570');
  });

  it('falls back to the geocoded point with check-pin when map data is unavailable', async () => {
    const down: MapDataSource = { id: 'down', around: async () => { throw new Error('offline'); } };
    const res = await new Resolver({ geocoder: geocoder(), mapData: down, records: memoryGateRecords([]) }).resolve(stop('677721'));
    expect(res.flags).toEqual(['check-pin']);
    expect(res.place?.confidence).toBe('guess');
  });
});

describe('PDPA', () => {
  it('sends no name, unit or phone to any provider', async () => {
    calls.length = 0;
    await resolver().resolve(stop('677723', { unit: '#03-18', recipient: 'Kumar & Devi', contact: '91234567', note: 'Lobby' }));
    const sent = calls.join('\n');
    expect(sent).not.toMatch(/#03-18|Kumar|Devi|91234567|Lobby/);
    expect(sent).toContain('postal:677723');
  });
});
