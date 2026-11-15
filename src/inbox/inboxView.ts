import type { Stop } from '../domain/types';
import { t } from '../i18n';
import { dedup } from './dedup';
import { parseText } from './parseText';

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

/** Paste box + parsed list. Everything stays in the page; nothing is sent anywhere. */
export function mountInbox(root: HTMLElement): void {
  root.innerHTML = `
    <section class="inbox">
      <h2>${esc(t('inbox.title'))}</h2>
      <textarea id="paste" rows="8" placeholder="${esc(t('inbox.placeholder'))}"></textarea>
      <button id="parse">${esc(t('inbox.parse'))}</button>
      <div id="result"></div>
    </section>`;
  const area = root.querySelector<HTMLTextAreaElement>('#paste');
  const out = root.querySelector<HTMLElement>('#result');
  root.querySelector('#parse')?.addEventListener('click', () => {
    if (!area || !out) return;
    const parsed = parseText(area.value);
    const { stops, merged } = dedup(parsed.stops);
    const ignored = parsed.ignored.length
      ? `<p class="ignored">${esc(t('inbox.ignored'))}<br>${parsed.ignored.map(esc).join('<br>')}</p>`
      : '';
    out.innerHTML = `<p>${esc(t('inbox.count', { n: stops.length }))}${merged ? ` · ${esc(t('inbox.merged', { n: merged }))}` : ''}</p>
      <ol>${stops.map((s, i) => stopRow(s, i + 1)).join('')}</ol>${ignored}`;
  });
}
