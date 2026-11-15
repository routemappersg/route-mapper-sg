import type { Stop } from '../domain/types';
import { parseAddressLine } from './parseText';

const COLUMNS: Record<string, string[]> = {
  postal: ['postal', 'postcode', 'postal code', 'zip', 'zipcode', 'sg postal'],
  unit: ['unit', 'unit no', 'unit number', '#'],
  recipient: ['name', 'recipient', 'customer', 'receiver'],
  contact: ['phone', 'contact', 'mobile', 'tel', 'hp'],
  address: ['address', 'street', 'location', 'delivery address'],
  note: ['note', 'notes', 'remarks', 'comment', 'comments', 'instructions'],
};

/** Minimal RFC-4180 CSV reader (quotes, escaped quotes, CRLF). */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Map header names to fields. Unmapped columns are reported, not silently dropped. */
export function mapColumns(header: string[]): { map: Record<string, number>; unmapped: string[] } {
  const map: Record<string, number> = {};
  const unmapped: string[] = [];
  header.forEach((h, i) => {
    const name = h.trim().toLowerCase();
    const field = Object.keys(COLUMNS).find((f) => COLUMNS[f]?.includes(name));
    if (field && map[field] === undefined) map[field] = i;
    else unmapped.push(h);
  });
  return { map, unmapped };
}

export interface CsvResult {
  stops: Stop[];
  unmappedColumns: string[];
  skippedRows: number[];
}

export function parseCsv(text: string, newId: () => string = counter()): CsvResult {
  const rows = readCsv(text);
  const header = rows[0] ?? [];
  const { map, unmapped } = mapColumns(header);
  const stops: Stop[] = [];
  const skippedRows: number[] = [];
  const cell = (r: string[], f: string): string => (map[f] === undefined ? '' : (r[map[f]!] ?? '').trim());

  rows.slice(1).forEach((r, idx) => {
    const line = [cell(r, 'address'), cell(r, 'unit'), cell(r, 'postal')].filter(Boolean).join(' ');
    const f = parseAddressLine(line);
    if (!f) {
      skippedRows.push(idx + 2);
      return;
    }
    const stop: Stop = { id: newId(), status: 'pending', flags: [] };
    if (f.postal) stop.postal = f.postal;
    if (f.block) stop.block = f.block;
    if (f.street) stop.street = f.street;
    if (f.unit) stop.unit = f.unit;
    const contact = cell(r, 'contact') || f.contact;
    if (contact) stop.contact = contact;
    const recipient = cell(r, 'recipient');
    if (recipient) stop.recipient = recipient;
    const note = [cell(r, 'note'), f.note].filter(Boolean).join('; ');
    if (note) stop.note = note;
    if (!stop.postal) stop.flags.push('no-postal');
    if (!stop.unit) stop.flags.push('no-unit');
    stops.push(stop);
  });
  return { stops, unmappedColumns: unmapped, skippedRows };
}

function counter(): () => string {
  let n = 0;
  return () => `c${++n}`;
}
