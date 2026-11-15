/** Owner-only endpoints for the admin console. Disabled entirely unless ADMIN_TOKEN is set. */
import type { Db } from './db';
import type { Env } from './env';
import { json, readJson } from './community';
import { Reject } from './guard';

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function admin(req: Request, url: URL, env: Env, db: Db, day: string, cap: number): Promise<Response | null> {
  if (!env.ADMIN_TOKEN) return null; // not configured: the routes do not exist
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!same(given, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const path = url.pathname;
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 100);

  if (req.method === 'GET') {
    if (path === '/admin/overview') {
      const [ors, reports, flagged, fb] = await Promise.all([
        db.counter('ors', day), db.listOpenReports(200), db.listNotes('flagged', 200), db.listFeedback('new', 200),
      ]);
      return json({
        day, ors, orsCap: cap,
        kill: (await db.getSetting('kill')) ?? '', banner: (await db.getSetting('banner')) ?? '',
        open: { reports: reports.length, flaggedNotes: flagged.length, newFeedback: fb.length },
      });
    }
    if (path === '/admin/reports') return json({ reports: await db.listOpenReports(limit) });
    if (path === '/admin/gates') return json({ gates: await db.listGates(limit) });
    if (path === '/admin/notes') {
      const s = url.searchParams.get('status');
      return json({ notes: await db.listNotes(s === 'hidden' || s === 'visible' ? s : 'flagged', limit) });
    }
    if (path === '/admin/feedback') {
      const s = url.searchParams.get('status');
      return json({ feedback: await db.listFeedback(s === 'triaged' || s === 'done' || s === 'all' ? s : 'new', limit) });
    }
    return null;
  }

  if (req.method !== 'POST') return null;
  const b = await readJson(req);
  const id = typeof b.id === 'string' && b.id.length <= 64 ? b.id : '';

  if (path === '/admin/gate/status' && id && (b.status === 'verified' || b.status === 'hidden')) {
    await db.setGateStatus(id, b.status);
    return json({ ok: true });
  }
  if (path === '/admin/gate') {
    // The owner can seed or lock a gate: source=admin records are never replaced automatically.
    const postals = Array.isArray(b.postals) ? (b.postals as unknown[]).map(String) : [];
    if (!postals.length || !postals.every((p) => /^\d{6}$/.test(p)) || typeof b.lat !== 'number' || typeof b.lng !== 'number') throw new Reject(400, 'bad-gate');
    const g = await db.saveGate({
      postals, lat: b.lat, lng: b.lng, gated: b.gated !== false, status: 'verified', source: 'admin', confirmations: 1,
      ...(typeof b.name === 'string' && b.name.length <= 60 ? { name: b.name } : {}),
    });
    return json({ gate: g });
  }
  if (path === '/admin/report/reject' && id) { await db.markReports([id], 'rejected'); return json({ ok: true }); }
  if (path === '/admin/note/status' && id && (b.status === 'visible' || b.status === 'hidden')) { await db.setNoteStatus(id, b.status); return json({ ok: true }); }
  if (path === '/admin/feedback/status' && id && (b.status === 'new' || b.status === 'triaged' || b.status === 'done')) { await db.setFeedbackStatus(id, b.status); return json({ ok: true }); }
  if (path === '/admin/settings') {
    if (typeof b.kill === 'string' && /^[a-z,]{0,40}$/.test(b.kill)) await db.setSetting('kill', b.kill);
    if (typeof b.banner === 'string' && b.banner.length <= 200) await db.setSetting('banner', b.banner);
    if (typeof b.orsDailyCap === 'number' && b.orsDailyCap >= 0 && b.orsDailyCap <= 5000) await db.setSetting('orsDailyCap', String(Math.floor(b.orsDailyCap)));
    return json({ ok: true });
  }
  return null;
}
