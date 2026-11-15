import type { Stop } from '../domain/types';
import { t } from '../i18n';
import type { KeyValueStore } from '../providers/types';
import { dedup } from './dedup';
import { loadInbox, saveInbox, wipeAll } from './inboxStore';
import { parseCsv } from './parseCsv';
import { parseText } from './parseText';
import { parseXlsxFile } from './parseXlsx';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function stopRow(s: Stop, n: number): string {
  const addr = [s.block, s.street].filter(Boolean).join(' ');
  const flags = s.flags.map((f) => `<span class="flag">${esc(t(`inbox.flag.${f}`))}</span>`).join('');
  const dl = s.deadlineMin !== undefined ? `<span class="flag due">${esc(t('inbox.by', { time: hhmm(s.deadlineMin) }))}</span>` : '';
  return `<li><b>${n}.</b> ${esc(addr)} ${esc(s.unit ?? '')} ${esc(s.postal ?? '')}
    <div class="sub">${esc([s.recipient, s.contact, s.note].filter(Boolean).join(' · '))}</div>${flags}${dl}</li>`;
}

let seq = 0;
const newId = (): string => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Paste box + file import + saved list. Everything stays on the device (IndexedDB);
 * nothing here makes a network request.
 */
export async function mountInbox(root: HTMLElement, store: KeyValueStore, prefill = ''): Promise<void> {
  let stops: Stop[] = await loadInbox(store);
  let notes: string[] = [];
  let message = '';

  root.innerHTML = `
    <section class="inbox">
      <h2>${esc(t('inbox.title'))}</h2>
      <textarea id="paste" rows="8" placeholder="${esc(t('inbox.placeholder'))}"></textarea>
      <div class="row">
        <button id="parse">${esc(t('inbox.parse'))}</button>
        <label class="btn">${esc(t('inbox.file'))}<input id="file" type="file" accept=".csv,.xlsx" hidden></label>
        <button id="wipe" class="ghost">${esc(t('inbox.wipe'))}</button>
      </div>
      <div id="result"></div>
    </section>`;
  const area = root.querySelector<HTMLTextAreaElement>('#paste');
  const out = root.querySelector<HTMLElement>('#result');
  if (area) area.value = prefill;

  const render = (): void => {
    if (!out) return;
    const ignored = notes.length
      ? `<p class="ignored">${esc(t('inbox.ignored'))}<br>${notes.map(esc).join('<br>')}</p>`
      : '';
    out.innerHTML = `<p>${esc(t('inbox.count', { n: stops.length }))}${message ? ` · ${esc(message)}` : ''}</p>
      <ol>${stops.map((s, i) => stopRow(s, i + 1)).join('')}</ol>${ignored}`;
  };

  const add = async (incoming: Stop[], extraNotes: string[]): Promise<void> => {
    const r = dedup([...stops, ...incoming]);
    stops = r.stops;
    notes = extraNotes;
    message = r.merged ? t('inbox.merged', { n: r.merged }) : '';
    await saveInbox(store, stops);
    render();
  };

  root.querySelector('#parse')?.addEventListener('click', () => {
    if (!area || !area.value.trim()) return;
    const p = parseText(area.value, newId);
    area.value = '';
    void add(p.stops, p.ignored);
  });

  root.querySelector<HTMLInputElement>('#file')?.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const isXlsx = /\.xlsx$/i.test(file.name);
    const r = isXlsx ? await parseXlsxFile(file) : parseCsv(await file.text(), newId);
    const extra = [
      ...r.unmappedColumns.map((c) => t('inbox.unmapped', { col: c })),
      ...r.skippedRows.map((n) => t('inbox.skipped', { row: n })),
    ];
    input.value = '';
    await add(r.stops, extra);
  });

  root.querySelector('#wipe')?.addEventListener('click', async () => {
    if (!window.confirm(t('inbox.wipe.confirm'))) return;
    await wipeAll(store);
    stops = [];
    notes = [];
    message = '';
    render();
  });

  render();
  if (prefill && area) area.focus();
}
