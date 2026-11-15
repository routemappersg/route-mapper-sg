/**
 * Community data: gates, corrected pins, drop-off notes, feedback. All of it is non-personal:
 * postal codes + coordinates + short screened notes. Submitters are salted one-way hashes.
 */
import { screenFeedback, screenNote } from '../../src/shared/screen';
import { decide } from './consensus';
import type { Db, FeedbackIn, GateRow } from './db';
import { inSingapore, parsePostals, Reject } from './guard';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Salted, monthly-rotating one-way hash of the caller's address: counts distinct submitters, identifies nobody. */
export async function submitterHash(ip: string, salt: string | undefined, nowMs: number): Promise<string> {
  const month = new Date(nowMs).toISOString().slice(0, 7);
  const data = new TextEncoder().encode(`${salt ?? 'unsalted'}|${month}|${ip}`);
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 24);
}

export async function readJson(req: Request, maxBytes = 4096): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Reject(413, 'too-large');
  const text = await req.text();
  if (text.length > maxBytes) throw new Reject(413, 'too-large');
  try {
    const v = JSON.parse(text) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('shape');
    return v as Record<string, unknown>;
  } catch {
    throw new Reject(400, 'bad-json');
  }
}

const publicGate = (g: GateRow) => ({ id: g.id, ...(g.name ? { name: g.name } : {}), postals: g.postals, gate: { lat: g.lat, lng: g.lng }, gated: g.gated });

export interface CommunityCtx {
  db: Db;
  ip: string;
  salt: string | undefined;
  now: number;
}

export async function community(req: Request, url: URL, c: CommunityCtx): Promise<Response | null> {
  const path = url.pathname;

  if (req.method === 'GET' && path === '/community/gates') {
    const gates = await c.db.verifiedGates(parsePostals(url.searchParams.get('postals')));
    return json({ gates: gates.map(publicGate) }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (req.method === 'GET' && path === '/community/notes') {
    const notes = await c.db.visibleNotes(parsePostals(url.searchParams.get('postals')));
    return json({ notes: notes.map((n) => ({ id: n.id, postal: n.postal, text: n.body })) }, 200, { 'cache-control': 'public, max-age=300' });
  }

  if (req.method !== 'POST') return null;

  if (path === '/community/report') {
    const b = await readJson(req);
    const postals = parsePostals(Array.isArray(b.postals) ? (b.postals as unknown[]).map(String).join(',') : null, 30);
    const kind = b.kind;
    if (kind !== 'gate' && kind !== 'pin') throw new Reject(400, 'bad-kind');
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number' || !inSingapore(b.lat, b.lng)) throw new Reject(400, 'bad-position');
    let name: string | undefined;
    if (typeof b.name === 'string' && b.name.trim()) {
      const s = screenNote(b.name);
      if (!s.ok || s.text.length > 60) throw new Reject(422, 'bad-name');
      name = s.text;
    }
    const submitter = await submitterHash(c.ip, c.salt, c.now);
    const report = await c.db.insertReport({ postals, kind, lat: b.lat, lng: b.lng, submitter, ...(name ? { name } : {}) });
    const d = decide(report, await c.db.openReports(postals), await c.db.gatesOverlapping(postals));
    if (!d) return json({ accepted: false });
    await c.db.saveGate({
      ...(d.replaces ? { id: d.replaces.id } : {}),
      ...(name ?? d.replaces?.name ? { name: (name ?? d.replaces?.name)! } : {}),
      postals: d.postals, lat: d.lat, lng: d.lng, gated: d.gated, status: 'verified', source: 'driver', confirmations: d.confirmations,
    });
    await c.db.markReports(d.reportIds, 'accepted');
    return json({ accepted: true });
  }

  if (path === '/community/note') {
    const b = await readJson(req);
    const postal = typeof b.postal === 'string' ? b.postal : '';
    if (!/^\d{6}$/.test(postal)) throw new Reject(400, 'bad-postal');
    const s = screenNote(typeof b.text === 'string' ? b.text : '');
    if (!s.ok) return json({ error: 'screened', reasons: s.reasons }, 422);
    const submitter = await submitterHash(c.ip, c.salt, c.now);
    const n = await c.db.insertNote({ postal, body: s.text, submitter });
    return json({ id: n.id });
  }

  if (path === '/community/note/flag') {
    const b = await readJson(req);
    if (typeof b.id !== 'string' || b.id.length > 64) throw new Reject(400, 'bad-id');
    const n = await c.db.flagNote(b.id, await submitterHash(c.ip, c.salt, c.now));
    // Three different people reporting a note hides it until the owner has looked.
    if (n >= 3) await c.db.setNoteStatus(b.id, 'hidden');
    return json({ flags: n });
  }

  if (path === '/community/feedback') {
    const b = await readJson(req);
    const kind = b.kind;
    if (kind !== 'rating' && kind !== 'bug' && kind !== 'idea') throw new Reject(400, 'bad-kind');
    const f: FeedbackIn = { kind };
    if (b.rating !== undefined) {
      if (!Number.isInteger(b.rating) || (b.rating as number) < 1 || (b.rating as number) > 5) throw new Reject(400, 'bad-rating');
      f.rating = b.rating as number;
    }
    if (typeof b.message === 'string' && b.message.trim()) f.message = screenFeedback(b.message).text;
    if (typeof b.appVersion === 'string' && /^[\w.-]{1,16}$/.test(b.appVersion)) f.appVersion = b.appVersion;
    if (b.diag && typeof b.diag === 'object' && !Array.isArray(b.diag)) {
      // Counters and short flags only. Anything else is dropped, so an address can never ride along.
      const diag: Record<string, number | string | boolean> = {};
      for (const [k, v] of Object.entries(b.diag as Record<string, unknown>).slice(0, 12)) {
        if (!/^[a-zA-Z]{1,16}$/.test(k)) continue;
        if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) diag[k] = v;
        else if (typeof v === 'string' && /^[\w.-]{1,16}$/.test(v)) diag[k] = v;
      }
      f.diag = diag;
    }
    if (f.kind !== 'rating' && !f.message) throw new Reject(400, 'empty');
    await c.db.insertFeedback(f);
    return json({ ok: true });
  }

  return null;
}
