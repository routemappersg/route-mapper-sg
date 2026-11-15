import { describe, expect, it } from 'vitest';
import { overpassQuery } from '../../src/providers/overpass';
import { harness, sgPts } from './harness';

const search = (q: string): string => `/onemap/api/common/elastic/search?searchVal=${encodeURIComponent(q)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

describe('OneMap proxy', () => {
  it('fetches a token once, adds it server-side, and caches postal lookups', async () => {
    const h = harness();
    const a = await h.send(search('677723'));
    expect(a.status).toBe(200);
    await h.send(search('677724'));
    const again = await h.send(search('677723'));
    expect(again.headers.get('x-cache')).toBe('hit');
    expect(h.upstreamCalls('getToken')).toHaveLength(1);
    const searches = h.upstreamCalls('elastic/search');
    expect(searches).toHaveLength(2); // the repeat was served from cache
    expect(searches[0]!.headers['authorization']).toBe('TOKEN1');
    expect(searches[0]!.url).toBe('https://www.onemap.gov.sg/api/common/elastic/search?searchVal=677723&returnGeom=Y&getAddrDetails=Y&pageNum=1');
  });

  it('renews the token and tries the Bearer format when the first attempt is refused', async () => {
    let n = 0;
    const h = harness({
      upstream: (u) => {
        if (u.url.includes('elastic/search')) {
          n++;
          return u.headers['authorization']?.startsWith('Bearer ') ? Response.json({ results: [{ POSTAL: '1' }] }) : new Response('no', { status: 401 });
        }
        return undefined;
      },
    });
    const r = await h.send(search('677723'));
    expect(r.status).toBe(200);
    expect(n).toBe(3); // raw, raw with a fresh token, then Bearer
    await h.send(search('677724'));
    expect(h.upstreamCalls('elastic/search').at(-1)!.headers['authorization']).toBe('Bearer TOKEN1'); // remembered
  });

  it('is unavailable without credentials, and when switched off', async () => {
    expect((await harness({ env: { ONEMAP_EMAIL: undefined } }).send(search('677723'))).status).toBe(503);
    expect((await harness({ env: { KILL: 'onemap' } }).send(search('677723'))).status).toBe(503);
  });
});

describe('Overpass proxy', () => {
  const body = overpassQuery({ lat: 1.3501234, lng: 103.8201234 }, 400);

  it('accepts only the app’s own query, caches it on a grid, and posts form-encoded upstream', async () => {
    const h = harness();
    const r = await h.send('/overpass', { method: 'POST', body });
    expect(r.status).toBe(200);
    const nearby = overpassQuery({ lat: 1.350121, lng: 103.820119 }, 400);
    expect((await h.send('/overpass', { method: 'POST', body: nearby })).headers.get('x-cache')).toBe('hit');
    const up = h.upstreamCalls('overpass');
    expect(up).toHaveLength(1);
    expect(up[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(decodeURIComponent(up[0]!.body)).toContain('around:400,1.350100,103.820100');
  });

  it('falls back to the next mirror', async () => {
    const h = harness({ upstream: (u) => (u.url.includes('overpass-api.de') ? new Response('busy', { status: 504 }) : undefined) });
    expect((await h.send('/overpass', { method: 'POST', body })).status).toBe(200);
    expect(h.upstreamCalls('overpass')).toHaveLength(2);
  });

  it.each([
    ['extra text', `${body}node(around:10,1.3,103.8)[name="Tan"];`],
    ['outside Singapore', overpassQuery({ lat: 3.1, lng: 101.7 }, 400)],
    ['radius too large', overpassQuery({ lat: 1.35, lng: 103.82 }, 5000)],
    ['not our query', '[out:json];node(1);out;'],
  ])('rejects %s', async (_n, q) => {
    const h = harness();
    expect((await h.send('/overpass', { method: 'POST', body: q })).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});

describe('openrouteservice proxy', () => {
  const matrix = { locations: sgPts(4), metrics: ['duration', 'distance'] };

  it('adds the key server-side and forwards only the allowed body', async () => {
    const h = harness();
    const r = await h.send('/ors/v2/matrix/driving-car', { json: matrix });
    expect(r.status).toBe(200);
    const up = h.upstreamCalls('openrouteservice')[0]!;
    expect(up.url).toBe('https://api.openrouteservice.org/v2/matrix/driving-car');
    expect(up.headers['authorization']).toBe('ORSKEY');
    expect(JSON.parse(up.body)).toEqual(matrix);
  });

  it('accepts the app’s optimization body', async () => {
    const h = harness();
    const body = {
      jobs: sgPts(3).map((l, i) => ({ id: i + 2, location: l, service: 180 })),
      vehicles: [{ id: 1, profile: 'driving-car', start: sgPts(1)[0], end: sgPts(1)[0] }],
    };
    expect((await h.send('/ors/optimization', { json: body })).status).toBe(200);
    expect((await h.send('/ors/v2/directions/driving-car/geojson', { json: { coordinates: sgPts(3) } })).status).toBe(200);
  });

  it.each([
    ['an extra field', { ...matrix, name: 'Mr Tan' }],
    ['a string in locations', { locations: [['103.8', '1.3'], ...sgPts(2)], metrics: ['duration'] }],
    ['a point outside Singapore', { locations: [[101.7, 3.1], ...sgPts(2)], metrics: ['duration'] }],
    ['more than 51 points', { locations: sgPts(52), metrics: ['duration'] }],
    ['an unknown metric', { locations: sgPts(3), metrics: ['duration', 'secret'] }],
  ])('rejects %s', async (_n, body) => {
    const h = harness();
    expect((await h.send('/ors/v2/matrix/driving-car', { json: body })).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects personal fields smuggled into an optimization job', async () => {
    const h = harness();
    const body = {
      jobs: [{ id: 2, location: sgPts(1)[0], service: 180, description: 'Mr Tan #03-18 91234567' }],
      vehicles: [{ id: 1, profile: 'driving-car', start: sgPts(1)[0] }],
    };
    const r = await h.send('/ors/optimization', { json: body });
    expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });

  it('does not forward unknown ORS paths', async () => {
    const h = harness();
    expect((await h.send('/ors/v2/isochrones/driving-car', { json: matrix })).status).toBe(404);
    expect(h.calls).toHaveLength(0);
  });

  it('stops at the daily cap with a 429 the app treats as "use the local engine"', async () => {
    const h = harness({ env: { ORS_DAILY_CAP: '2' } });
    expect((await h.send('/ors/v2/matrix/driving-car', { json: matrix })).status).toBe(200);
    expect((await h.send('/ors/v2/matrix/driving-car', { json: matrix })).status).toBe(200);
    const third = await h.send('/ors/v2/matrix/driving-car', { json: matrix });
    expect(third.status).toBe(429);
    expect(h.upstreamCalls('openrouteservice')).toHaveLength(2);
    h.advance(86_400_000); // next UTC day: a fresh allowance
    expect((await h.send('/ors/v2/matrix/driving-car', { json: matrix })).status).toBe(200);
  });

  it('turns an upstream 429 into a 429 and other upstream failures into 502', async () => {
    expect((await harness({ upstream: () => new Response('', { status: 429 }) }).send('/ors/v2/matrix/driving-car', { json: matrix })).status).toBe(429);
    expect((await harness({ upstream: () => new Response('', { status: 500 }) }).send('/ors/v2/matrix/driving-car', { json: matrix })).status).toBe(502);
  });
});

describe('guards on the OneMap search', () => {
  it.each([
    ['677723', 200], ['12 Hougang Street 51', 200], ['4B Ghim Moh Road', 200],
    ['91234567', 400], ['Mr Tan', 400], ['12 Hougang St 51 #03-18', 400], ['677723 9123 4567', 400], ['', 400],
  ])('searchVal %s -> %i', async (q, status) => {
    const h = harness();
    expect((await h.send(search(q))).status).toBe(status);
    if (status === 400) expect(h.calls).toHaveLength(0);
  });

  it('rejects unexpected query parameters', async () => {
    const h = harness();
    expect((await h.send(`${search('677723')}&name=Tan`)).status).toBe(400);
    expect((await h.send('/onemap/api/common/elastic/search?searchVal=677723&returnGeom=N&getAddrDetails=Y&pageNum=1')).status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});

describe('operations', () => {
  it('rate limits a single address per minute', async () => {
    const h = harness();
    let last = 200;
    for (let i = 0; i < 100; i++) last = (await h.send('/health', { ip: '9.9.9.9' })).status;
    expect(last).toBe(429);
    expect((await h.send('/health', { ip: '8.8.8.8' })).status).toBe(200);
    h.advance(61_000);
    expect((await h.send('/health', { ip: '9.9.9.9' })).status).toBe(200);
  });

  it('allows only listed origins (plus localhost for development) and answers preflight', async () => {
    const h = harness();
    const ok = await h.send('/health', { headers: { origin: 'https://app.test' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test');
    expect((await h.send('/health', { headers: { origin: 'https://evil.test' } })).headers.get('access-control-allow-origin')).toBeNull();
    expect((await h.send('/health', { headers: { origin: 'http://localhost:5173' } })).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const pre = await h.send('/ors/v2/matrix/driving-car', { method: 'OPTIONS', headers: { origin: 'https://app.test' } });
    expect(pre.status).toBe(204);
  });

  it('reports what is available, and honours the kill-switch from the database within a minute', async () => {
    const h = harness();
    const cfg = async (): Promise<{ providers: Record<string, boolean>; banner: string | null }> => (await h.send('/config')).json();
    expect((await cfg()).providers).toEqual({ geocode: true, mapData: true, route: true, community: true });
    await h.db.setSetting('kill', 'ors');
    await h.db.setSetting('banner', 'Routing is limited today');
    h.advance(61_000);
    const c = await cfg();
    expect(c.providers.route).toBe(false);
    expect(c.banner).toBe('Routing is limited today');
    expect((await h.send('/ors/v2/matrix/driving-car', { json: { locations: sgPts(3), metrics: ['duration'] } })).status).toBe(503);
    expect((await harness({ withDb: false, env: { ORS_API_KEY: undefined } }).send('/config').then((r) => r.json()) as { providers: Record<string, boolean> }).providers).toMatchObject({ route: false, community: false });
  });

  it('an unreachable upstream is a clean 502 with no detail', async () => {
    const h = harness({ upstream: () => { throw new Error('secret stack detail ORSKEY'); } });
    const r = await h.send('/ors/v2/matrix/driving-car', { json: { locations: sgPts(3), metrics: ['duration'] } });
    expect(r.status).toBe(502);
    expect(await r.text()).not.toMatch(/secret|ORSKEY/);
  });

  it('never echoes internals on an unexpected error', async () => {
    const h = harness();
    h.db.verifiedGates = async () => { throw new Error('secret database detail SERVICEKEY'); };
    const r = await h.send('/community/gates?postals=677723');
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('{"error":"internal"}');
  });
});

describe('PDPA sweep: nothing personal reaches any upstream', () => {
  it('blocks every attempt to carry a name, unit or phone out', async () => {
    const h = harness();
    const attempts: Promise<Response>[] = [
      h.send(search('Tan Ah Kow')), h.send(search('91234567')), h.send(search('#03-18')),
      h.send(`${search('677723')}&q=%2303-18`),
      h.send('/overpass', { method: 'POST', body: 'node[name="Tan Ah Kow"];out;' }),
      h.send('/ors/v2/matrix/driving-car', { json: { locations: sgPts(3), metrics: ['duration'], note: '91234567' } }),
      h.send('/ors/optimization', { json: { jobs: [{ id: 2, location: sgPts(1)[0], service: 1, contact: '91234567' }], vehicles: [{ id: 1, profile: 'driving-car', start: sgPts(1)[0] }] } }),
    ];
    for (const r of await Promise.all(attempts)) expect(r.status).toBe(400);
    expect(h.calls).toHaveLength(0);
  });
});
