/**
 * Database interface. Everything the Worker stores goes through this: community gates/pins/notes,
 * feedback, counters and runtime settings. Production uses Supabase (db-supabase.ts); tests and
 * the local end-to-end run use db-memory.ts. NO personal data is ever stored: submitters are
 * one-way salted hashes, notes are screened, feedback is redacted.
 */
export type ReportKind = 'gate' | 'pin';

export interface GateRow {
  id: string;
  name?: string;
  postals: string[];
  lat: number;
  lng: number;
  /** true = main gate of a gated development; false = corrected drop-off pin for a non-gated address. */
  gated: boolean;
  status: 'verified' | 'hidden';
  source: 'driver' | 'seed' | 'admin';
  confirmations: number;
  updatedAt: string;
}

export interface ReportIn {
  postals: string[];
  kind: ReportKind;
  lat: number;
  lng: number;
  name?: string;
  /** One-way salted hash. Not reversible to a person or device. */
  submitter: string;
}

export interface ReportRow extends ReportIn {
  id: string;
  status: 'open' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface NoteRow {
  id: string;
  postal: string;
  body: string;
  status: 'visible' | 'hidden';
  flags: number;
  createdAt: string;
}

export interface FeedbackIn {
  kind: 'rating' | 'bug' | 'idea';
  rating?: number;
  message?: string;
  appVersion?: string;
  /** Whitelisted counters/flags only: never addresses. */
  diag?: Record<string, number | string | boolean>;
}

export interface FeedbackRow extends FeedbackIn {
  id: string;
  status: 'new' | 'triaged' | 'done';
  createdAt: string;
}

export interface PurgeResult {
  reports: number;
  feedback: number;
}

export interface Db {
  // runtime settings and counters (kill-switch, quota)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Add 1 to a named daily counter and return the new value. */
  bump(name: string, day: string): Promise<number>;
  counter(name: string, day: string): Promise<number>;

  // community gates and pins
  verifiedGates(postals: string[]): Promise<GateRow[]>;
  gatesOverlapping(postals: string[]): Promise<GateRow[]>;
  saveGate(g: Omit<GateRow, 'id' | 'updatedAt'> & { id?: string }): Promise<GateRow>;
  listGates(limit: number): Promise<GateRow[]>;
  setGateStatus(id: string, status: GateRow['status']): Promise<void>;
  insertReport(r: ReportIn): Promise<ReportRow>;
  openReports(postals: string[]): Promise<ReportRow[]>;
  listOpenReports(limit: number): Promise<ReportRow[]>;
  markReports(ids: string[], status: 'accepted' | 'rejected'): Promise<void>;

  // community notes
  visibleNotes(postals: string[]): Promise<NoteRow[]>;
  insertNote(n: { postal: string; body: string; submitter: string }): Promise<NoteRow>;
  /** Record a report against a note; returns the number of distinct reporters. */
  flagNote(id: string, submitter: string): Promise<number>;
  setNoteStatus(id: string, status: NoteRow['status']): Promise<void>;
  listNotes(status: NoteRow['status'] | 'flagged', limit: number): Promise<NoteRow[]>;

  // feedback
  insertFeedback(f: FeedbackIn): Promise<FeedbackRow>;
  listFeedback(status: FeedbackRow['status'] | 'all', limit: number): Promise<FeedbackRow[]>;
  setFeedbackStatus(id: string, status: FeedbackRow['status']): Promise<void>;

  // ops
  ping(): Promise<void>;
  purge(cutoff: { reportsBefore: string; feedbackBefore: string }): Promise<PurgeResult>;
}
