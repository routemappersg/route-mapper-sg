export function allowedOrigin(origin: string | null, list: string | undefined): string | null {
  if (!origin) return null;
  const allowed = (list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  // Local development is always allowed so `vite` can talk to a local Worker.
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return allowed.includes(origin) ? origin : null;
}

export function withCors(res: Response, origin: string | null): Response {
  const h = new Headers(res.headers);
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin);
    h.append('Vary', 'Origin');
  }
  return new Response(res.body, { status: res.status, headers: h });
}

export const preflight = (origin: string | null): Response =>
  new Response(null, {
    status: 204,
    headers: {
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
