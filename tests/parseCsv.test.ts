import { describe, expect, it } from 'vitest';
import { parseCsv, readCsv } from '../src/inbox/parseCsv';

describe('csv import', () => {
  it('reads quoted cells and CRLF', () => {
    expect(readCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });

  it('maps common headers, parses addresses, and reports unmapped columns and skipped rows', () => {
    const csv = [
      'Customer,Delivery Address,Unit,Postcode,Mobile,Remarks,Weight',
      'Mei,"464B Clementi Ave 1",#11-32,122464,91234567,Leave at door,2kg',
      'Ravi,not an address,,,,,',
    ].join('\n');
    const r = parseCsv(csv);
    expect(r.unmappedColumns).toEqual(['Weight']);
    expect(r.skippedRows).toEqual([3]);
    expect(r.stops[0]).toMatchObject({
      recipient: 'Mei', block: '464B', street: 'Clementi Avenue 1', unit: '#11-32',
      postal: '122464', contact: '91234567', note: 'Leave at door',
    });
  });
});
