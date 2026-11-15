import type { Stop } from '../domain/types';
import { expandStreet } from './abbreviations';

export interface ParsedList {
  stops: Stop[];
  /** Lines that were not stops. Always shown to the user, never silently routed or dropped. */
  ignored: string[];
  /** A deadline on a line of its own (applies to the list; the user decides which stops). */
  listDeadlineMin?: number;
}

const BULLET = /^[\s*•\-–·]+/;
const UNIT = /#\s*\d{1,3}\s*-\s*\d{1,5}[A-Za-z]?/;
const PHONE = /(?:\+65[\s-]?)?(?<!\d)[689]\d{3}[\s-]?\d{4}(?!\d)/;
const POSTAL = /(?:singapore\s*)?\(?\s*s?\s*\(?\s*(?<!\d)(\d{6})(?!\d)\s*\)?/i;
const BLOCK_STREET = /^(?:blk|block)?\s*\d+[a-z]?\s+[a-z]/i;
const DEADLINE =
  /\b(?:send\s+)?(?:by|before)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]*)\))?/i;
const STREET_END =
  /^(.*?\b(?:road|rd|street|st|avenue|ave|av|drive|dr|crescent|cres|gardens|gdns|lane|ln|way|close|cl|walk|link|rise|place|pl|terrace|ter|view|central|heights|hill|park|loop)\b(?:\s+\d+[a-z]?)?(?:\s+(?:west|east|north|south|central))?)\b(.*)$/i;

function deadlineMinutes(h: string, m: string | undefined, ap: string | undefined): number {
  let hour = parseInt(h, 10);
  const min = m ? parseInt(m, 10) : 0;
  const mer = ap?.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return hour * 60 + min;
}

function tidy(s: string): string {
  return s.replace(/[,.;:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isNameLike(line: string): boolean {
  if (line.length > 40 || /\d/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length > 5) return false;
  return words.every((w) => /^[\p{Lu}(&]/u.test(w) || w.toLowerCase() === 'and');
}

function isAddressLine(line: string): boolean {
  return UNIT.test(line) || POSTAL.test(line) || BLOCK_STREET.test(line.replace(/^\W+/, ''));
}

export interface AddressFields {
  postal?: string;
  block?: string;
  street?: string;
  unit?: string;
  contact?: string;
  note?: string;
  deadlineMin?: number;
}

/** Parse one address line into fields. Returns null if it is not an address. */
export function parseAddressLine(raw: string): AddressFields | null {
  let s = raw.replace(BULLET, '').trim();
  if (!s || !isAddressLine(s)) return null;
  const out: AddressFields = {};

  const dl = DEADLINE.exec(s);
  if (dl && dl[1]) {
    out.deadlineMin = deadlineMinutes(dl[1], dl[2], dl[3]);
    s = s.replace(DEADLINE, ' ');
  }
  const unit = UNIT.exec(s);
  if (unit) {
    out.unit = unit[0].replace(/\s+/g, '').toUpperCase();
    s = s.replace(UNIT, ' ');
  }
  const phone = PHONE.exec(s);
  if (phone) {
    out.contact = phone[0].replace(/[\s-]/g, '');
    s = s.replace(PHONE, ' ');
  }
  const postal = POSTAL.exec(s);
  if (postal && postal[1]) {
    out.postal = postal[1];
    s = s.replace(POSTAL, ' ');
  }

  s = tidy(s);
  const bs = /^(?:blk|block)?\s*(\d+[a-z]?)\s+(.+)$/i.exec(s);
  if (bs && bs[1] && bs[2]) {
    out.block = bs[1].toUpperCase();
    const rest = bs[2];
    const end = STREET_END.exec(rest);
    if (end && end[1]) {
      out.street = expandStreet(end[1]);
      const extra = (end[2] ?? '').trim();
      if (extra) out.note = extra;
    } else {
      out.street = expandStreet(rest);
    }
  } else if (s) {
    out.street = expandStreet(s);
  }
  return out;
}

/** Parse pasted free text (WhatsApp, notes) into stops. */
export function parseText(text: string, newId: () => string = counter()): ParsedList {
  const stops: Stop[] = [];
  const ignored: string[] = [];
  let listDeadlineMin: number | undefined;

  for (const block of text.split(/\n\s*\n/)) {
    let pendingName: string | undefined;
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(BULLET, '').trim();
      if (!line) continue;
      const fields = parseAddressLine(line);
      if (fields) {
        const stop: Stop = { id: newId(), status: 'pending', flags: [] };
        if (fields.postal) stop.postal = fields.postal;
        if (fields.block) stop.block = fields.block;
        if (fields.street) stop.street = fields.street;
        if (fields.unit) stop.unit = fields.unit;
        if (fields.contact) stop.contact = fields.contact;
        if (fields.note) stop.note = fields.note;
        if (fields.deadlineMin !== undefined) stop.deadlineMin = fields.deadlineMin;
        if (pendingName) stop.recipient = pendingName;
        if (!stop.postal) stop.flags.push('no-postal');
        if (!stop.unit) stop.flags.push('no-unit');
        if (!stop.block && !stop.postal) stop.flags.push('check-address');
        stops.push(stop);
        pendingName = undefined;
      } else if (isNameLike(line)) {
        pendingName = line;
      } else {
        const dl = DEADLINE.exec(line);
        if (dl && dl[1] && line.length < 40) {
          listDeadlineMin = deadlineMinutes(dl[1], dl[2], dl[3]);
        }
        ignored.push(line);
      }
    }
  }
  return { stops, ignored, ...(listDeadlineMin !== undefined ? { listDeadlineMin } : {}) };
}

function counter(): () => string {
  let n = 0;
  return () => `s${++n}`;
}
