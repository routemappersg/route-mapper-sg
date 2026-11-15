import { describe, expect, it } from 'vitest';
import { harness } from './harness';

const GATE = { lat: 1.3401, lng: 103.7501 };
const near = (m: number) => ({ lat: GATE.lat + m / 111_000, lng: GATE.lng });
const report = (h: ReturnType<typeof harness>, ip: string, pos = GATE, postals = ['677721', '677722'], kind = 'gate') =>
  h.send('/community/report', { ip, json: { postals, kind, ...pos } });
const gates = async (h: ReturnType<typeof harness>, p = '677722'): Promise<{ gates: { postals: string[]; gate: { lat: number }; gated: boolean }[] }> =>
  (await h.send(`/community/gates?postals=${p}`)).json();

describe('community gates: agreement, not login', () => {
  it('one report is only a report; two different drivers within 30 m make a verified gate for the whole development', async () => {
    const h = harness();
    expect(await (await report(h, '10.0.0.1')).json()).toEqual({ accepted: false });
    expect((await gates(h)).gates).toHaveLength(0);
    expect(await (await report(h, '10.0.0.2', near(12), ['677722', '677723'])).json()).toEqual({ accepted: true });
    const g = (await gates(h, '677723')).gates;
    expect(g).toHaveLength(1);
    expect(g[0]!.postals.sort()).toEqual(['677721', '677722', '677723']);
    expect(g[0]!.gated).toBe(true);
  });

  it('the same person reporting twice counts once', async () => {
    const h = harness();
    await report(h, '10.0.0.1');
    expect(await (await report(h, '10.0.0.1')).json()).toEqual({ accepted: false });
    expect((await gates(h)).gates).toHaveLength(0);
  });

  it('reports that disagree by more than 30 m do not combine', async () => {
    const h = harness();
    await report(h, '10.0.0.1');
    expect(await (await report(h, '10.0.0.2', near(80))).json()).toEqual({ accepted: false });
  });

  it('replacing a community gate needs three who agree with each other, not two', async () => {
    const h = harness();
    await report(h, '10.0.0.1'); await report(h, '10.0.0.2', near(5));
    expect((await gates(h)).gates).toHaveLength(1);
    const elsewhere = near(200);
    await report(h, '10.0.0.3', elsewhere);
    expect(await (await report(h, '10.0.0.4', { lat: elsewhere.lat + 0.00005, lng: elsewhere.lng })).json()).toEqual({ accepted: false });
    expect(await (await report(h, '10.0.0.5', elsewhere)).json()).toEqual({ accepted: true });
    const g = (await gates(h)).gates;
    expect(g).toHaveLength(1); // replaced, not duplicated
    expect(Math.abs(g[0]!.gate.lat - elsewhere.lat)).toBeLessThan(0.0001);
  });

  it('a gate set by the owner is never replaced automatically', async () => {
    const h = harness();
    await h.send('/admin/gate', { headers: { authorization: 'Bearer admin-secret' }, json: { postals: ['677721', '677722'], ...GATE, name: 'Blossom Residences' } });
    const far = near(300);
    for (const ip of ['1', '2', '3', '4']) await report(h, `10.1.0.${ip}`, far);
    const g = (await gates(h)).gates;
    expect(g[0]!.gate.lat).toBeCloseTo(GATE.lat, 6);
  });

  it('a non-gated pin correction is stored as a plain drop-off point', async () => {
    const h = harness();
    await report(h, '10.0.0.1', GATE, ['350115'], 'pin');
    await report(h, '10.0.0.2', near(8), ['350115'], 'pin');
    expect((await gates(h, '350115')).gates[0]!.gated).toBe(false);
  });

  it.each([
    ['a position outside Singapore', { postals: ['677721'], kind: 'gate', lat: 3.1, lng: 101.7 }],
    ['a bad postal code', { postals: ['6777'], kind: 'gate', ...GATE }],
    ['an unknown kind', { postals: ['677721'], kind: 'x', ...GATE }],
    ['a personal-looking name', { postals: ['677721'], kind: 'gate', ...GATE, name: 'Mr Tan #03-18' }],
  ])('rejects %s', async (_n, body) => {
    const h = harness();
    const r = await h.send('/community/report', { json: body });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(h.db.dump().reports).toHaveLength(0);
  });

  it('stores a one-way hash, never the address', async () => {
    const h = harness();
    await report(h, '203.0.113.9');
    const stored = JSON.stringify(h.db.dump());
    expect(stored).not.toContain('203.0.113.9');
    expect(h.db.dump().reports[0]!.submitter).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('community notes', () => {
  const note = (h: ReturnType<typeof harness>, text: string, ip = '10.0.0.1') => h.send('/community/note', { ip, json: { postal: '677722', text } });

  it('publishes a clean note and rejects personal-looking ones with the reason', async () => {
    const h = harness();
    expect((await note(h, 'Guardhouse on the left, register then Blk 3')).status).toBe(200);
    const bad = await note(h, 'Call Mdm Lim on 9123 4567');
    expect(bad.status).toBe(422);
    expect((await bad.json() as { reasons: string[] }).reasons).toEqual(expect.arrayContaining(['phone', 'title-name']));
    const shown = await (await h.send('/community/notes?postals=677722')).json() as { notes: { text: string }[] };
    expect(shown.notes.map((n) => n.text)).toEqual(['Guardhouse on the left, register then Blk 3']);
  });

  it('three different people reporting a note hides it', async () => {
    const h = harness();
    const id = ((await (await note(h, 'Use the side gate')).json()) as { id: string }).id;
    const flag = (ip: string) => h.send('/community/note/flag', { ip, json: { id } });
    await flag('1.0.0.1'); await flag('1.0.0.1'); await flag('1.0.0.2');
    expect(((await (await h.send('/community/notes?postals=677722')).json()) as { notes: unknown[] }).notes).toHaveLength(1);
    await flag('1.0.0.3');
    expect(((await (await h.send('/community/notes?postals=677722')).json()) as { notes: unknown[] }).notes).toHaveLength(0);
  });
});

describe('feedback', () => {
  it('redacts personal-looking text and keeps only whitelisted diagnostics', async () => {
    const h = harness();
    const r = await h.send('/community/feedback', {
      json: {
        kind: 'bug', message: 'Wrong pin for Mdm Lim at #03-18 677723, call 91234567', appVersion: '0.0.1',
        diag: { stops: 13, flagged: 3, locale: 'en', address: '12 Hougang St 51', unit: '#03-18', nested: { a: 1 }, 'bad key!': 1 },
      },
    });
    expect(r.status).toBe(200);
    const row = h.db.dump().feedback[0]!;
    expect(row.message).not.toMatch(/Lim|03-18|91234567/);
    expect(row.message).toContain('677723'); // a postal code is not personal
    expect(row.diag).toEqual({ stops: 13, flagged: 3, locale: 'en' });
  });

  it('accepts a bare 1-tap rating and rejects bad input', async () => {
    const h = harness();
    expect((await h.send('/community/feedback', { json: { kind: 'rating', rating: 5 } })).status).toBe(200);
    expect((await h.send('/community/feedback', { json: { kind: 'rating', rating: 9 } })).status).toBe(400);
    expect((await h.send('/community/feedback', { json: { kind: 'bug' } })).status).toBe(400);
    expect((await h.send('/community/feedback', { json: { kind: 'bug', message: 'x'.repeat(5000) } })).status).toBe(413);
  });

  it('rate limits writes per address', async () => {
    const h = harness();
    let last = 200;
    for (let i = 0; i < 25; i++) last = (await h.send('/community/feedback', { ip: '7.7.7.7', json: { kind: 'rating', rating: 4 } })).status;
    expect(last).toBe(429);
  });
});

describe('admin console API', () => {
  const as = { headers: { authorization: 'Bearer admin-secret' } };

  it('does not exist unless ADMIN_TOKEN is set, and rejects a wrong token', async () => {
    expect((await harness({ env: { ADMIN_TOKEN: undefined } }).send('/admin/overview', as)).status).toBe(404);
    const h = harness();
    expect((await h.send('/admin/overview')).status).toBe(401);
    expect((await h.send('/admin/overview', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await h.send('/admin/overview', as)).status).toBe(200);
  });

  it('shows what needs attention, and lets the owner act on it', async () => {
    const h = harness();
    await report(h, '10.0.0.1');
    await h.send('/community/feedback', { json: { kind: 'bug', message: 'Gate wrong' } });
    const id = ((await (await h.send('/community/note', { json: { postal: '677722', text: 'Use the side gate' } })).json()) as { id: string }).id;
    await h.send('/community/note/flag', { json: { id } });
    const o = await (await h.send('/admin/overview', as)).json() as { open: Record<string, number> };
    expect(o.open).toEqual({ reports: 1, flaggedNotes: 1, newFeedback: 1 });

    const rep = ((await (await h.send('/admin/reports', as)).json()) as { reports: { id: string }[] }).reports[0]!;
    expect((await h.send('/admin/report/reject', { ...as, json: { id: rep.id } })).status).toBe(200);
    expect((await h.send('/admin/note/status', { ...as, json: { id, status: 'hidden' } })).status).toBe(200);
    const fb = ((await (await h.send('/admin/feedback', as)).json()) as { feedback: { id: string }[] }).feedback[0]!;
    await h.send('/admin/feedback/status', { ...as, json: { id: fb.id, status: 'done' } });
    const after = await (await h.send('/admin/overview', as)).json() as { open: Record<string, number> };
    expect(after.open).toEqual({ reports: 0, flaggedNotes: 0, newFeedback: 0 });
  });

  it('turns a provider off or on, and the app is told within a minute', async () => {
    const h = harness();
    await h.send('/admin/settings', { ...as, json: { kill: 'ors,overpass', banner: 'Planned maintenance', orsDailyCap: 50 } });
    h.advance(61_000);
    const cfg = await (await h.send('/config')).json() as { providers: Record<string, boolean>; banner: string };
    expect(cfg.providers).toMatchObject({ route: false, mapData: false, geocode: true });
    expect(cfg.banner).toBe('Planned maintenance');
    expect(((await (await h.send('/admin/overview', as)).json()) as { orsCap: number }).orsCap).toBe(50);
  });

  it('rejects a malformed gate seed', async () => {
    const h = harness();
    expect((await h.send('/admin/gate', { ...as, json: { postals: ['12'], lat: 1.3, lng: 103.8 } })).status).toBe(400);
  });
});

describe('daily job', () => {
  it('pings the database and purges old closed reports and feedback, never open ones', async () => {
    const h = harness();
    await report(h, '10.0.0.1');
    await report(h, '10.0.0.2', near(200)); // two disagreeing open reports
    await h.send('/community/feedback', { json: { kind: 'bug', message: 'old one' } });
    const old = h.db.dump();
    old.reports[0]!.status = 'rejected';
    old.reports[0]!.createdAt = '2026-01-01T00:00:00.000Z';
    old.feedback[0]!.createdAt = '2025-01-01T00:00:00.000Z';
    await h.app.scheduled(h.env);
    const left = h.db.dump();
    expect(left.reports.map((r) => r.status)).toEqual(['open']);
    expect(left.feedback).toHaveLength(0);
  });

  it('does nothing without a database', async () => {
    await expect(harness({ withDb: false }).app.scheduled({})).resolves.toBeUndefined();
  });
});
