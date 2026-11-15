import type { Db, FeedbackRow, GateRow, NoteRow, ReportRow } from './db';

/** In-memory Db for tests and the local end-to-end run. Mirrors the behaviour of the Supabase implementation. */
export function memoryDb(now: () => number = Date.now): Db & { dump(): { gates: GateRow[]; reports: ReportRow[]; notes: NoteRow[]; feedback: FeedbackRow[] } } {
  let seq = 0;
  const id = (): string => `id${++seq}`;
  const iso = (): string => new Date(now()).toISOString();
  const settings = new Map<string, string>();
  const counters = new Map<string, number>();
  const gates: GateRow[] = [];
  const reports: ReportRow[] = [];
  const notes: NoteRow[] = [];
  const flags = new Map<string, Set<string>>();
  const feedback: FeedbackRow[] = [];
  const overlap = (a: string[], b: string[]): boolean => a.some((x) => b.includes(x));

  return {
    async getSetting(k) { return settings.get(k) ?? null; },
    async setSetting(k, v) { settings.set(k, v); },
    async bump(name, day) { const k = `${name}|${day}`; const n = (counters.get(k) ?? 0) + 1; counters.set(k, n); return n; },
    async counter(name, day) { return counters.get(`${name}|${day}`) ?? 0; },

    async verifiedGates(postals) { return gates.filter((g) => g.status === 'verified' && overlap(g.postals, postals)); },
    async gatesOverlapping(postals) { return gates.filter((g) => overlap(g.postals, postals)); },
    async saveGate(g) {
      const row: GateRow = { ...g, id: g.id ?? id(), updatedAt: iso() };
      const i = gates.findIndex((x) => x.id === row.id);
      if (i >= 0) gates[i] = row; else gates.push(row);
      return row;
    },
    async listGates(limit) { return gates.slice(-limit).reverse(); },
    async setGateStatus(gid, status) { const g = gates.find((x) => x.id === gid); if (g) g.status = status; },
    async insertReport(r) { const row: ReportRow = { ...r, id: id(), status: 'open', createdAt: iso() }; reports.push(row); return row; },
    async openReports(postals) { return reports.filter((r) => r.status === 'open' && overlap(r.postals, postals)); },
    async listOpenReports(limit) { return reports.filter((r) => r.status === 'open').slice(-limit).reverse(); },
    async markReports(ids, status) { for (const r of reports) if (ids.includes(r.id)) r.status = status; },

    async visibleNotes(postals) { return notes.filter((n) => n.status === 'visible' && postals.includes(n.postal)); },
    async insertNote(n) { const row: NoteRow = { id: id(), postal: n.postal, body: n.body, status: 'visible', flags: 0, createdAt: iso() }; notes.push(row); return row; },
    async flagNote(nid, submitter) {
      const s = flags.get(nid) ?? new Set<string>();
      s.add(submitter);
      flags.set(nid, s);
      const note = notes.find((x) => x.id === nid);
      if (note) note.flags = s.size;
      return s.size;
    },
    async setNoteStatus(nid, status) { const n = notes.find((x) => x.id === nid); if (n) n.status = status; },
    async listNotes(status, limit) {
      const pick = status === 'flagged' ? notes.filter((n) => n.flags > 0 && n.status === 'visible') : notes.filter((n) => n.status === status);
      return pick.slice(-limit).reverse();
    },

    async insertFeedback(f) { const row: FeedbackRow = { ...f, id: id(), status: 'new', createdAt: iso() }; feedback.push(row); return row; },
    async listFeedback(status, limit) { return feedback.filter((f) => status === 'all' || f.status === status).slice(-limit).reverse(); },
    async setFeedbackStatus(fid, status) { const f = feedback.find((x) => x.id === fid); if (f) f.status = status; },

    async ping() { /* alive */ },
    async purge(cut) {
      const before = { r: reports.length, f: feedback.length };
      for (let i = reports.length - 1; i >= 0; i--) if (reports[i]!.status !== 'open' && reports[i]!.createdAt < cut.reportsBefore) reports.splice(i, 1);
      for (let i = feedback.length - 1; i >= 0; i--) if (feedback[i]!.createdAt < cut.feedbackBefore) feedback.splice(i, 1);
      return { reports: before.r - reports.length, feedback: before.f - feedback.length };
    },
    dump: () => ({ gates, reports, notes, feedback }),
  };
}
