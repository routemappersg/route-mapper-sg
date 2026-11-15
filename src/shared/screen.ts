/**
 * Text screening for anything that leaves the device as free text (community notes, feedback).
 * Runs in the app (instant feedback) and again in the Worker (the authoritative check).
 *
 * Community notes are PUBLIC and must be non-personal, so personal-looking text is REJECTED.
 * Feedback is private to the owner, so personal-looking text is REDACTED and the rest is kept.
 * Pattern matching cannot catch every name: notes are also moderated and reportable.
 */

export type ScreenReason = 'phone' | 'unit' | 'email' | 'id-number' | 'url' | 'title-name' | 'long-number' | 'empty' | 'too-long';

export interface ScreenResult {
  /** Safe to store/show. For notes: false when anything personal was found. */
  ok: boolean;
  /** Cleaned text (control characters and markup removed; for 'redact' mode, personal parts replaced). */
  text: string;
  reasons: ScreenReason[];
}

interface Rule { reason: ScreenReason; re: RegExp; replace: string }

// Order matters: specific patterns before generic digit runs.
const RULES: Rule[] = [
  { reason: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi, replace: '[email]' },
  { reason: 'url', re: /\b(?:https?:\/\/|www\.)\S+/gi, replace: '[link]' },
  // Singapore NRIC/FIN: S1234567A
  { reason: 'id-number', re: /\b[STFGM]\d{7}[A-Z]\b/gi, replace: '[id]' },
  // Unit numbers: #12-345, # 12 - 345, unit 12-345, 12-345A
  { reason: 'unit', re: /#\s*\d{1,3}\s*[-–]\s*\d{1,4}[A-Z]?\b/gi, replace: '[unit]' },
  { reason: 'unit', re: /\b(?:unit|apt|apartment|flat|room|rm)\.?\s*#?\s*\d{1,4}(?:\s*[-–]\s*\d{1,4}[A-Z]?)?\b/gi, replace: '[unit]' },
  { reason: 'unit', re: /\b\d{1,3}\s*[-–]\s*\d{2,4}[A-Z]?\b/g, replace: '[unit]' },
  // Phone: optional +65/0065, then 8 digits starting 3/6/8/9, with optional single separators
  { reason: 'phone', re: /(?:\+|00)?\s*65[\s-]?[3689]\d{3}[\s-]?\d{4}\b/g, replace: '[phone]' },
  { reason: 'phone', re: /\b[3689]\d{3}[\s-]?\d{4}\b/g, replace: '[phone]' },
  // "Mr Tan", "Mdm Lim", "Aunty Joyce": a title followed by a capitalised word
  { reason: 'title-name', re: /\b(?:mr|mrs|mdm|madam|ms|miss|dr|aunty|auntie|uncle|ah\s+(?:gong|ma|ba))\.?\s+[A-Z][a-z]+\b/gi, replace: '[name]' },
  // Any other long digit run (7+) that is not a 6-digit postal code
  { reason: 'long-number', re: /\b\d{7,}\b/g, replace: '[number]' },
];

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const clean = (s: string): string =>
  s.replace(CONTROL, ' ').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/**
 * @param mode 'reject': personal-looking text makes ok=false (public notes).
 *             'redact': personal-looking parts are replaced and ok stays true (private feedback).
 */
export function screenText(input: string, mode: 'reject' | 'redact', maxLen: number): ScreenResult {
  let text = clean(input ?? '');
  const reasons = new Set<ScreenReason>();
  if (!text) return { ok: false, text: '', reasons: ['empty'] };
  for (const { reason, re, replace } of RULES) {
    re.lastIndex = 0;
    if (re.test(text)) {
      reasons.add(reason);
      re.lastIndex = 0;
      text = text.replace(re, replace);
    }
  }
  if (text.length > maxLen) {
    reasons.add('too-long');
    text = text.slice(0, maxLen);
  }
  const personal = [...reasons].some((r) => r !== 'too-long');
  const ok = mode === 'redact' ? text.length > 0 : !personal && !reasons.has('too-long');
  return { ok, text, reasons: [...reasons] };
}

export const screenNote = (s: string): ScreenResult => screenText(s, 'reject', 140);
export const screenFeedback = (s: string): ScreenResult => screenText(s, 'redact', 1000);
