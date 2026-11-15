/** Supabase (PostgREST) implementation of Db. Uses the service_role key, which only the Worker holds. */
import type { Db, FeedbackIn, FeedbackRow, GateRow, NoteRow, ReportRow } from './db';

type F = typeof fetch;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS6 = /^\d{6}$/;

const uuid = (s: string): string => {
  if (!UUID.test(s)) throw new Error('bad-id');
  return s;
};
const arr = (postals: string[]): string => {
  if (!postals.length || !postals.every((p) => DIGITS6.test(p))) throw new Error('bad-postals');
  return `{${postals.join(',')}}`;
};

type Row = Record<string, unknown>;
const gate = (r: Row): GateRow => ({
  id: r.id as string, ...(r.name ? { name: r.name as string } : {}), postals: r.postals as string[],
  lat: r.lat as number, lng: r.lng as number, gated: r.gated as boolean, status: r.status as GateRow['status'],
  source: r.source as GateRow['source'], confirmations: r.confirmations as number, updatedAt: r.updated_at as string,
});
const report = (r: Row): ReportRow => ({
  id: r.id as string, postals: r.postals as string[], kind: r.kind as ReportRow['kind'], lat: r.lat as number, lng: r.lng as number,
  ...(r.name ? { name: r.name as string } : {}), submitter: r.submitter as string, status: r.status as ReportRow['status'], createdAt: r.created_at as string,
});
const note = (r: Row): NoteRow => ({
  id: r.id as string, postal: r.postal as string, body: r.body as string, status: r.status as NoteRow['status'], flags: r.flags as number, createdAt: r.created_at as string,
});
const feedback = (r: Row): FeedbackRow => ({
  id: r.id as string, kind: r.kind as FeedbackRow['kind'], ...(r.rating ? { rating: r.rating as number } : {}),
  ...(r.message ? { message: r.message as string } : {}), ...(r.app_version ? { appVersion: r.app_version as string } : {}),
  ...(r.diag ? { diag: r.diag as FeedbackRow['diag'] } : {}), status: r.status as FeedbackRow['status'], createdAt: r.created_at as string,
});

export function supabaseDb(baseUrl: string, serviceKey: string, f: F): Db {
  const root = `${baseUrl.replace(/\/+$/, '')}/rest/v1`;
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    // Legacy service_role keys are JWTs and are sent both ways. New secret keys (sb_secret_...) are not JWTs
    // and go in the apikey header only.
    apikey: serviceKey, ...(serviceKey.startsWith('sb_') ? {} : { authorization: `Bearer ${serviceKey}` }), 'content-type': 'application/json', ...extra,
  });

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await f(`${root}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) } });
    if (!res.ok) throw new Error(`supabase ${res.status}`);
    return res;
  }
  const rows = async (path: string): Promise<Row[]> => (await (await call(path)).json()) as Row[];
  const insert = async (table: string, body: unknown): Promise<Row> =>
    ((await (await call(`/${table}`, { method: 'POST', body: JSON.stringify(body), headers: { prefer: 'return=representation' } })).json()) as Row[])[0]!;
  const patch = async (table: string, filter: string, body: unknown): Promise<void> => {
    await call(`/${table}?${filter}`, { method: 'PATCH', body: JSON.stringify(body), headers: { prefer: 'return=minimal' } });
  };
  const rpc = async (fn: string, body: unknown): Promise<number> => Number(await (await call(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) })).json());
  const countDeleted = async (table: string, filter: string): Promise<number> => {
    const res = await call(`/${table}?${filter}`, { method: 'DELETE', headers: { prefer: 'return=minimal,count=exact' } });
    return Number((res.headers.get('content-range') ?? '').split('/')[1]) || 0;
  };
  const iso = (s: string): string => {
    if (Number.isNaN(Date.parse(s))) throw new Error('bad-date');
    return encodeURIComponent(s);
  };

  return {
    async getSetting(key) {
      const r = await rows(`/settings?key=eq.${encodeURIComponent(key)}&select=value&limit=1`);
      return (r[0]?.value as string | undefined) ?? null;
    },
    async setSetting(key, value) {
      await call('/settings?on_conflict=key', { method: 'POST', body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }), headers: { prefer: 'resolution=merge-duplicates,return=minimal' } });
    },
    bump: (name, day) => rpc('bump_counter', { p_name: name, p_day: day }),
    async counter(name, day) {
      const r = await rows(`/counters?name=eq.${encodeURIComponent(name)}&day=eq.${encodeURIComponent(day)}&select=n&limit=1`);
      return (r[0]?.n as number | undefined) ?? 0;
    },

    async verifiedGates(postals) { return (await rows(`/gate_records?status=eq.verified&postals=ov.${arr(postals)}&select=*`)).map(gate); },
    async gatesOverlapping(postals) { return (await rows(`/gate_records?postals=ov.${arr(postals)}&select=*`)).map(gate); },
    async saveGate(g) {
      const body = { name: g.name ?? null, postals: g.postals, lat: g.lat, lng: g.lng, gated: g.gated, status: g.status, source: g.source, confirmations: g.confirmations, updated_at: new Date().toISOString() };
      if (g.id) {
        const r = await (await call(`/gate_records?id=eq.${uuid(g.id)}`, { method: 'PATCH', body: JSON.stringify(body), headers: { prefer: 'return=representation' } })).json() as Row[];
        return gate(r[0]!);
      }
      return gate(await insert('gate_records', body));
    },
    async listGates(limit) { return (await rows(`/gate_records?select=*&order=updated_at.desc&limit=${Math.min(200, limit)}`)).map(gate); },
    async setGateStatus(id, status) { await patch('gate_records', `id=eq.${uuid(id)}`, { status, updated_at: new Date().toISOString() }); },
    async insertReport(r) { return report(await insert('pin_reports', { postals: r.postals, kind: r.kind, lat: r.lat, lng: r.lng, name: r.name ?? null, submitter: r.submitter })); },
    async openReports(postals) { return (await rows(`/pin_reports?status=eq.open&postals=ov.${arr(postals)}&select=*`)).map(report); },
    async listOpenReports(limit) { return (await rows(`/pin_reports?status=eq.open&select=*&order=created_at.desc&limit=${Math.min(200, limit)}`)).map(report); },
    async markReports(ids, status) {
      if (!ids.length) return;
      await patch('pin_reports', `id=in.(${ids.map(uuid).join(',')})`, { status });
    },

    async visibleNotes(postals) {
      if (!postals.every((p) => DIGITS6.test(p))) throw new Error('bad-postals');
      return (await rows(`/notes?status=eq.visible&postal=in.(${postals.join(',')})&select=*&order=created_at.desc&limit=200`)).map(note);
    },
    async insertNote(n) { return note(await insert('notes', { postal: n.postal, body: n.body, submitter: n.submitter })); },
    flagNote: (id, submitter) => rpc('flag_note', { p_id: uuid(id), p_submitter: submitter }),
    async setNoteStatus(id, status) { await patch('notes', `id=eq.${uuid(id)}`, { status }); },
    async listNotes(status, limit) {
      const filter = status === 'flagged' ? 'status=eq.visible&flags=gt.0' : `status=eq.${status}`;
      return (await rows(`/notes?${filter}&select=*&order=created_at.desc&limit=${Math.min(200, limit)}`)).map(note);
    },

    async insertFeedback(fb: FeedbackIn) {
      return feedback(await insert('feedback', { kind: fb.kind, rating: fb.rating ?? null, message: fb.message ?? null, app_version: fb.appVersion ?? null, diag: fb.diag ?? null }));
    },
    async listFeedback(status, limit) {
      const filter = status === 'all' ? '' : `status=eq.${status}&`;
      return (await rows(`/feedback?${filter}select=*&order=created_at.desc&limit=${Math.min(200, limit)}`)).map(feedback);
    },
    async setFeedbackStatus(id, status) { await patch('feedback', `id=eq.${uuid(id)}`, { status }); },

    async ping() { await rows('/settings?select=key&limit=1'); },
    async purge(cut) {
      const reports = await countDeleted('pin_reports', `status=neq.open&created_at=lt.${iso(cut.reportsBefore)}`);
      const fb = await countDeleted('feedback', `created_at=lt.${iso(cut.feedbackBefore)}`);
      return { reports, feedback: fb };
    },
  };
}
