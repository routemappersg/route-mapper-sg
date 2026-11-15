import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../src/inbox/parseText';
import { dedup } from '../src/inbox/dedup';

const fixture = readFileSync('tests/fixtures/d4-01.txt', 'utf8');
const list = parseText(fixture);
const byPostal = (p: string) => list.stops.find((s) => s.postal === p);

describe('D4-01 WhatsApp list', () => {
  it('finds 13 stops, 10 with postal codes and 3 flagged for confirmation', () => {
    expect(list.stops).toHaveLength(13);
    expect(list.stops.filter((s) => s.postal)).toHaveLength(10);
    const noPostal = list.stops.filter((s) => s.flags.includes('no-postal'));
    expect(noPostal.map((s) => `${s.block} ${s.street}`)).toEqual([
      '543 Choa Chu Kang Street 52',
      '401 Pandan Gardens',
      '570 Hougang Street 51',
    ]);
  });

  it('reads all postal formats', () => {
    for (const p of ['540248', '530444', '692128', '650355', '270004', '122464', '600274', '120410', '350115', '677723']) {
      expect(byPostal(p), p).toBeDefined();
    }
  });

  it('keeps block letters in upper case and never drops them', () => {
    expect(byPostal('692128')?.block).toBe('128B');
    expect(byPostal('122464')?.block).toBe('464B');
  });

  it('finds units in any position', () => {
    expect(byPostal('650355')?.unit).toBe('#03-127');
    expect(byPostal('530444')?.unit).toBe('#07-1211');
    expect(byPostal('600274')?.unit).toBe('#05-219');
    expect(byPostal('120410')?.unit).toBe('#09-2147');
  });

  it('expands abbreviations', () => {
    expect(byPostal('540248')?.street).toBe('Compassvale Road');
    expect(byPostal('530444')?.street).toBe('Hougang Avenue 8');
    expect(byPostal('120410')?.street).toBe('Commonwealth Avenue West');
    expect(byPostal('350115')?.street).toBe('Potong Pasir Avenue 1');
  });

  it('attaches the name line above the address, and handles a stop with no name', () => {
    expect(byPostal('540248')?.recipient).toBe('Arun & Mei');
    expect(byPostal('650355')?.recipient).toBe("Daniel's Mom");
    expect(list.stops[0]?.recipient).toBeUndefined();
  });

  it('shows the comment line instead of routing it, and does not mistake it for a name', () => {
    expect(list.ignored).toEqual(['A couple more on the parcel itself, so i dont have those records']);
    expect(byPostal('692128')?.recipient).toBe('Daniel');
  });

  it('captures the 1 PM deadline on the first stop', () => {
    expect(list.stops[0]?.deadlineMin).toBe(13 * 60);
    expect(list.stops[0]?.block).toBe('543');
    expect(list.stops[0]?.unit).toBe('#09-112');
  });

  it('keeps the development name as a drop-off note (Blossom Residences)', () => {
    const s = byPostal('677723');
    expect(s?.street).toBe('Segar Road');
    expect(s?.note).toBe('Lobby Blossom Residences');
  });

  it('never merges stops by name (two Aruns)', () => {
    expect(dedup(list.stops).merged).toBe(0);
    expect(list.stops.filter((s) => s.recipient?.startsWith('Arun'))).toHaveLength(2);
  });
});

describe('dedup', () => {
  it('merges the same postal + unit arriving twice and fills gaps', () => {
    const a = parseText('Sam\n10 Foo Road #01-01 S123456').stops;
    const b = parseText('10 Foo Road #01-01 S123456 91234567').stops;
    const r = dedup([...a, ...b]);
    expect(r.merged).toBe(1);
    expect(r.stops[0]?.contact).toBe('91234567');
    expect(r.stops[0]?.recipient).toBe('Sam');
  });
});
