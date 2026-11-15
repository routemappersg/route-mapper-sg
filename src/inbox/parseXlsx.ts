import { parseRows, type CsvResult } from './parseCsv';

/** Read the first sheet of an .xlsx file in the browser and parse it like a CSV. Stays on the device. */
export async function parseXlsxFile(file: File | Blob): Promise<CsvResult> {
  const { readSheet } = await import('read-excel-file/browser');
  const data = await readSheet(file);
  return parseRows(data as unknown[][]);
}
