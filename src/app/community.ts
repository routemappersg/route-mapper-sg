/**
 * Driver-to-driver community data: "this gate/pin is wrong", short drop-off notes, feedback.
 * Everything sent is non-personal: postal code + coordinates, a screened note, or redacted feedback.
 * If the phone is offline the item waits in a small outbox on the device and is sent next time.
 */
import type { KeyValueStore } from '../providers/types';
import { screenFeedback, screenNote, type ScreenReason } from '../shared/screen';
import { API_BASE, ApiError, fetchJson, postJson } from './config';

const OUTBOX = 'community-outbox';
const MAX_QUEUED = 20;
interface Queued { path: string; body: unknown }

const authoritative = (e: unknown): boolean => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429;

async function enqueue(store: KeyValueStore, item: Queued): Promise<void> {
  const q = (await store.get<Queued[]>(OUTBOX)) ?? [];
  await store.set(OUTBOX, [...q, item].slice(-MAX_QUEUED));
}

export type SendResult = 'sent' | 'queued' | 'rejected' | 'off';

async function send(store: KeyValueStore, path: string, body: unknown, base: string): Promise<{ result: SendResult; data?: unknown }> {
  if (!base) return { result: 'off' };
  try {
    return { result: 'sent', data: await postJson(`${base}${path}`, body) };
  } catch (e) {
    if (authoritative(e)) return { result: 'rejected' }; // the server said no: retrying will not help
    await enqueue(store, { path, body });
    return { result: 'queued' };
  }
}

/** Send anything that was waiting for a connection. Safe to call at every start-up. */
export async function flushOutbox(store: KeyValueStore, base = API_BASE): Promise<number> {
  const q = (await store.get<Queued[]>(OUTBOX)) ?? [];
  if (!base || q.length === 0) return 0;
  const left: Queued[] = [];
  let sent = 0;
  for (const item of q) {
    try { await postJson(`${base}${item.path}`, item.body); sent++; } catch (e) { if (!authoritative(e)) left.push(item); }
  }
  await store.set(OUTBOX, left);
  return sent;
}

/** "The gate/drop-off point is here." The position is where the driver is standing: coordinates only. */
export async function reportPin(store: KeyValueStore, o: { postal: string; gated: boolean; lat: number; lng: number }, base = API_BASE): Promise<SendResult> {
  return (await send(store, '/community/report', { postals: [o.postal], kind: o.gated ? 'gate' : 'pin', lat: o.lat, lng: o.lng }, base)).result;
}

export async function shareNote(store: KeyValueStore, postal: string, text: string, base = API_BASE): Promise<{ result: SendResult; reasons?: ScreenReason[] }> {
  const s = screenNote(text);
  if (!s.ok) return { result: 'rejected', reasons: s.reasons };
  return { result: (await send(store, '/community/note', { postal, text: s.text }, base)).result };
}

export async function flagNote(store: KeyValueStore, id: string, base = API_BASE): Promise<SendResult> {
  return (await send(store, '/community/note/flag', { id }, base)).result;
}

export interface CommunityNote { id: string; postal: string; text: string }
const noteCache = new Map<string, CommunityNote[]>();
export async function notesFor(postal: string, base = API_BASE): Promise<CommunityNote[]> {
  if (!base || !/^\d{6}$/.test(postal)) return [];
  const hit = noteCache.get(postal);
  if (hit) return hit;
  try {
    const r = (await fetchJson(`${base}/community/notes?postals=${postal}`)) as { notes?: CommunityNote[] };
    noteCache.set(postal, r.notes ?? []);
    return r.notes ?? [];
  } catch {
    return [];
  }
}

export type FeedbackKind = 'bug' | 'idea' | 'rating';
/** Feedback is private to the owner. Personal-looking text is removed before it leaves the phone. */
export async function sendFeedback(store: KeyValueStore, f: { kind: FeedbackKind; message?: string; rating?: number; stops?: number; flagged?: number }, base = API_BASE): Promise<SendResult> {
  const body: Record<string, unknown> = { kind: f.kind, appVersion: '0.0.1', diag: { ...(f.stops !== undefined ? { stops: f.stops } : {}), ...(f.flagged !== undefined ? { flagged: f.flagged } : {}), locale: document.documentElement.lang || 'en' } };
  if (f.rating !== undefined) body.rating = f.rating;
  if (f.message) body.message = screenFeedback(f.message).text;
  return (await send(store, '/community/feedback', body, base)).result;
}
