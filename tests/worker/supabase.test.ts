import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supabaseDb } from '../../worker/src/db-supabase';

describe('Supabase REST client: request shapes', () => {
  const rec = (reply: unknown = [], headers: Record<string, string> = {}) => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const h: Record<string, string> = {};
      new Headers(init?.headers).forEach((v, k) => { h[k] = v; });
      calls.push({ url, method: init?.method ?? 'GET', headers: h, body: typeof init?.body === 'string' ? init.body : '' });
      return new Response(JSON.stringify(reply), { status: 200, headers });
    }) as unknown as typeof fetch;
    return { calls, db: supabaseDb('https://proj.supabase.co/', 'SERVICEKEY', f) };
  };

  it('sends the service key and filters on postal overlap', async () => {
    const { calls, db } = rec([]);
    await db.verifiedGates(['677721', '677722']);
    expect(calls[0]!.url).toBe('https://proj.supabase.co/rest/v1/gate_records?status=eq.verified&postals=ov.{677721,677722}&select=*');
    expect(calls[0]!.headers['apikey']).toBe('SERVICEKEY');
    expect(calls[0]!.headers['authorization']).toBe('Bearer SERVICEKEY');
  });

  it('refuses ids and postal codes that are not the expected shape (no filter injection)', async () => {
    const { calls, db } = rec([]);
    await expect(db.verifiedGates(['677721),status.eq.hidden'])).rejects.toThrow();
    await expect(db.markReports(['x),id.neq.0'], 'rejected')).rejects.toThrow();
    await expect(db.setNoteStatus('not-a-uuid', 'hidden')).rejects.toThrow();
    await expect(db.visibleNotes(['12345a'])).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('counts through the atomic function and reports purge counts', async () => {
    const a = rec(7);
    expect(await a.db.bump('ors', '2026-11-15')).toBe(7);
    expect(a.calls[0]!.url).toBe('https://proj.supabase.co/rest/v1/rpc/bump_counter');
    expect(JSON.parse(a.calls[0]!.body)).toEqual({ p_name: 'ors', p_day: '2026-11-15' });
    const b = rec([], { 'content-range': '*/4' });
    expect(await b.db.purge({ reportsBefore: '2026-08-01T00:00:00.000Z', feedbackBefore: '2026-05-01T00:00:00.000Z' })).toEqual({ reports: 4, feedback: 4 });
    expect(b.calls[0]!.url).toContain('pin_reports?status=neq.open&created_at=lt.2026-08-01T00%3A00%3A00.000Z');
  });

  it('maps rows back to the app shapes', async () => {
    const { db } = rec([{ id: 'a', name: 'Blossom', postals: ['677721'], lat: 1.3, lng: 103.7, gated: true, status: 'verified', source: 'driver', confirmations: 2, updated_at: 'x' }]);
    expect((await db.verifiedGates(['677721']))[0]).toMatchObject({ id: 'a', name: 'Blossom', gated: true, confirmations: 2 });
  });
});

describe('Supabase schema, run for real in Postgres', () => {
  const sql = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');
  const fresh = async (): Promise<PGlite> => {
    const db = new PGlite();
    // Supabase provides these roles; recreate them so the grants and policies can be checked.
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema if not exists extensions;');
    await db.exec(sql);
    return db;
  };

  it('applies cleanly, and can be re-run', async () => {
    const db = await fresh();
    await expect(db.exec(sql)).resolves.toBeDefined();
  });

  it('the public roles cannot read or write anything; the Worker role can', async () => {
    const db = await fresh();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const t of ['gate_records', 'pin_reports', 'notes', 'note_flags', 'feedback', 'settings', 'counters']) {
        await expect(db.query(`select * from public.${t}`), `${role} select ${t}`).rejects.toThrow(/permission denied/);
      }
      await expect(db.query(`insert into public.feedback (kind) values ('bug')`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select public.bump_counter('x', current_date)`)).rejects.toThrow(/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.query(`insert into public.feedback (kind, message) values ('bug', 'ok')`);
    expect((await db.query('select * from public.feedback')).rows).toHaveLength(1);
  });

  it('has row level security on every table', async () => {
    const db = await fresh();
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r'`);
    expect(r.rows.length).toBe(7);
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([]);
  });

  it('counts atomically and dedups note flags by submitter', async () => {
    const db = await fresh();
    await db.exec('set role service_role');
    expect((await db.query<{ bump_counter: number }>(`select public.bump_counter('ors', '2026-11-15')`)).rows[0]!.bump_counter).toBe(1);
    expect((await db.query<{ bump_counter: number }>(`select public.bump_counter('ors', '2026-11-15')`)).rows[0]!.bump_counter).toBe(2);
    const n = await db.query<{ id: string }>(`insert into public.notes (postal, body, submitter) values ('677722', 'Use side gate', 'h1') returning id`);
    const id = n.rows[0]!.id;
    const flag = async (s: string): Promise<number> => (await db.query<{ flag_note: number }>(`select public.flag_note('${id}', '${s}')`)).rows[0]!.flag_note;
    expect(await flag('a')).toBe(1);
    expect(await flag('a')).toBe(1);
    expect(await flag('b')).toBe(2);
    expect((await db.query<{ flags: number }>(`select flags from public.notes where id = '${id}'`)).rows[0]!.flags).toBe(2);
  });

  it('constraints reject out-of-Singapore pins, bad postals, long or bad data', async () => {
    const db = await fresh();
    await db.exec('set role service_role');
    const bad = [
      `insert into public.gate_records (postals, lat, lng, source) values ('{677721}', 3.1, 101.7, 'driver')`,
      `insert into public.gate_records (postals, lat, lng, source) values ('{}', 1.3, 103.8, 'driver')`,
      `insert into public.notes (postal, body, submitter) values ('12345', 'x', 'h')`,
      `insert into public.notes (postal, body, submitter) values ('123456', '${'x'.repeat(141)}', 'h')`,
      `insert into public.feedback (kind, rating) values ('rating', 9)`,
      `insert into public.pin_reports (postals, kind, lat, lng, submitter) values ('{677721}', 'weird', 1.3, 103.8, 'h')`,
    ];
    for (const q of bad) await expect(db.query(q), q).rejects.toThrow();
    await expect(db.query(`insert into public.gate_records (postals, lat, lng, source) values ('{677721,677722}', 1.34, 103.75, 'driver')`)).resolves.toBeDefined();
  });

  it('finds gates by postal overlap', async () => {
    const db = await fresh();
    await db.exec('set role service_role');
    await db.query(`insert into public.gate_records (postals, lat, lng, source) values ('{677721,677722}', 1.34, 103.75, 'driver')`);
    expect((await db.query(`select 1 from public.gate_records where postals && '{677722}'`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.gate_records where postals && '{999999}'`)).rows).toHaveLength(0);
  });
});
