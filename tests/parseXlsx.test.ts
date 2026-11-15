import { describe, expect, it } from 'vitest';
import { readSheet } from 'read-excel-file/node';
import { parseRows } from '../src/inbox/parseCsv';

describe('xlsx import', () => {
  it('parses rows and restores a postal code that lost its leading zero', async () => {
    const data = await readSheet('tests/fixtures/sample.xlsx');
    const r = parseRows(data as unknown[][]);
    expect(r.stops).toHaveLength(2);
    expect(r.stops[0]).toMatchObject({ recipient: 'Mei', block: '464B', street: 'Clementi Avenue 1', unit: '#11-32', postal: '122464', contact: '91234567' });
    expect(r.stops[1]).toMatchObject({ block: '10', street: 'Anson Road', postal: '018956' });
  });
});
