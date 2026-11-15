import { describe, expect, it } from 'vitest';
import { oneMapGeocoder } from '../src/providers/onemap';
import { overpassQuery, parseOverpass } from '../src/providers/overpass';
import { offset } from '../src/resolve/geo';

describe('OneMap adapter', () => {
  // Response shape follows OneMap's elastic/search fields; values are synthetic.
  const body = {
    found: 2, totalNumPages: 1, pageNum: 1,
    results: [
      { BLK_NO: '34', ROAD_NAME: 'SEGAR ROAD', BUILDING: 'NIL', ADDRESS: 'x', POSTAL: '677723', LATITUDE: '1.3801', LONGITUDE: '103.7702' },
      { BLK_NO: '128', ROAD_NAME: 'PLANTATION CRESCENT', BUILDING: 'NIL', ADDRESS: 'x', POSTAL: '690128', LATITUDE: 'x', LONGITUDE: 'y' },
    ],
  };
  const urls: string[] = [];
  const g = oneMapGeocoder({ baseUrl: 'https://worker.example', fetchJson: async (u) => { urls.push(u); return body; } });

  it('calls the Worker with only the postal code and maps the fields', async () => {
    const hit = await g.byPostal('677723');
    expect(urls[0]).toBe('https://worker.example/api/common/elastic/search?searchVal=677723&returnGeom=Y&getAddrDetails=Y&pageNum=1');
    expect(hit).toEqual({ postal: '677723', block: '34', street: 'Segar Road', position: { lat: 1.3801, lng: 103.7702 } });
  });

  it('drops results without valid coordinates and treats NIL as empty', async () => {
    const hits = await g.bySearch('34', 'Segar Road');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.building).toBeUndefined();
    expect(urls[1]).toContain('searchVal=34%20Segar%20Road');
  });
});

describe('Overpass adapter', () => {
  const b = { lat: 1.38, lng: 103.77 };
  const g = (e: number, n: number) => { const p = offset(b, e, n); return { lat: p.lat, lon: p.lng }; };
  const ring = [g(0, 0), g(200, 0), g(200, 200), g(0, 200), g(0, 0)];

  it('builds an around query for roads, barriers, guardhouses and estates', () => {
    const q = overpassQuery(b, 400);
    expect(q).toContain('way(around:400,1.380000,103.770000)[highway]');
    expect(q).toContain('[building=guardhouse]');
  });

  it('parses roads, gates and marks an estate gated when a guardhouse sits on its edge', () => {
    const area = parseOverpass({
      elements: [
        { type: 'way', id: 1, tags: { highway: 'tertiary', name: 'Segar Road' }, geometry: [g(-100, -20), g(300, -20)] },
        { type: 'way', id: 2, tags: { highway: 'service', access: 'private' }, geometry: [g(100, -20), g(100, 100)] },
        { type: 'way', id: 3, tags: { highway: 'footway' }, geometry: [g(0, 0), g(10, 10)] },
        { type: 'way', id: 4, tags: { building: 'guardhouse' }, geometry: [g(104, 2), g(112, 2), g(112, 8), g(104, 8), g(104, 2)] },
        { type: 'node', id: 5, ...g(100, 0), tags: { barrier: 'lift_gate' } },
        { type: 'node', id: 6, ...g(200, 60), tags: { barrier: 'turnstile' } },
        { type: 'node', id: 7, ...g(50, 50), tags: { barrier: 'bollard' } },
        { type: 'way', id: 8, tags: { landuse: 'residential', name: 'Synthetic Residences' }, geometry: ring },
      ],
    });
    expect(area.roads.map((r) => [r.cls, r.private])).toEqual([['tertiary', false], ['service', true]]);
    expect(area.gates.map((x) => x.kind).sort()).toEqual(['barrier', 'guardhouse', 'pedestrian']);
    expect(area.developments[0]).toMatchObject({ name: 'Synthetic Residences', gated: true });
  });
});
