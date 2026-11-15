/**
 * Runs the real Worker code locally for end-to-end tests: in-memory database, in-memory cache and
 * stubbed upstreams (OneMap, Overpass, openrouteservice). Every request the Worker makes upstream
 * is logged to /upstream.log so a test can prove no personal data left the Worker.
 *   npx tsx tests/e2e/localWorker.ts [port]
 */
import { createServer } from 'node:http';
import { createApp } from '../../worker/src/app';
import { memoryDb } from '../../worker/src/db-memory';

const port = Number(process.argv[2] ?? 8788);
const db = memoryDb(() => Date.now());
const upstream: { url: string; body: string }[] = [];
const store = new Map<string, Response>();

const pos = (postal: string): [number, number] => {
  const n = Number(postal);
  return [1.27 + ((n * 7919) % 1000) / 5500, 103.7 + ((n * 104729) % 1000) / 3500];
};
const km = (a: [number, number], b: [number, number]): number => Math.hypot((a[0] - b[0]) * 111, (a[1] - b[1]) * 111 * 0.9994);

const stub = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const body = typeof init?.body === 'string' ? init.body : '';
  upstream.push({ url, body });
  if (url.includes('getToken')) return Response.json({ access_token: 'T', expiry_timestamp: String(Math.floor(Date.now() / 1000) + 259200) });
  if (url.includes('elastic/search')) {
    const q = new URL(url).searchParams.get('searchVal') ?? '';
    if (!/^\d{6}$/.test(q)) return Response.json({ results: [] });
    const [lat, lng] = pos(q);
    return Response.json({ results: [{ POSTAL: q, BLK_NO: '1', ROAD_NAME: 'TEST ROAD', LATITUDE: String(lat), LONGITUDE: String(lng) }] });
  }
  if (url.includes('overpass')) return Response.json({ elements: [] });
  if (url.includes('/v2/matrix/')) {
    const { locations } = JSON.parse(body) as { locations: [number, number][] };
    const d = locations.map((a) => locations.map((b) => Math.round(km([a[1], a[0]], [b[1], b[0]]) * 90)));
    return Response.json({ durations: d, distances: d.map((r) => r.map((v) => v * 12)) });
  }
  if (url.includes('/directions/')) {
    const { coordinates } = JSON.parse(body) as { coordinates: [number, number][] };
    return Response.json({ features: [{ geometry: { coordinates } }] });
  }
  return new Response('stub: not implemented', { status: 500 }); // optimization: app falls back to its own engine
}) as typeof fetch;

const app = createApp({
  now: () => Date.now(), fetch: stub, db: () => db,
  cache: { match: async (r) => store.get(r.url)?.clone(), put: async (r, v) => { store.set(r.url, v.clone()); } },
});
const env = { ONEMAP_EMAIL: 'e', ONEMAP_PASSWORD: 'p', ORS_API_KEY: 'k', HASH_SALT: 's', ADMIN_TOKEN: 'admin-e2e', ALLOWED_ORIGINS: '' };

createServer(async (req, res) => {
  if (req.url === '/__upstream') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(upstream)); return; }
  if (req.url === '/__db') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(db.dump())); return; }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const r = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) });
  const out = await app.fetch(r, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`local worker on ${port}`));
