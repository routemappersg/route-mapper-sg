import { t } from '../i18n';
import { evaluate } from '../optimize/evaluate';
import { planRoute } from '../optimize/plan';
import type { KeyValueStore, Providers } from '../providers/types';
import { wipeAll } from '../inbox/inboxStore';
import type { MapPoint, RouteMap } from '../review/mapView';
import { clock, deadlineText, optimizeInputs, orderFromResult } from '../review/model';
import {
  applyRemainingOrder, counts, currentIndex, finish, NAV_APPS, navUrl, nextIndex, position, remaining, remainingRun,
  remainingSchedule, retry, skip, telHref, undoLast, whatsappHref, type ActiveRun, type NavApp,
} from './model';
import { clearRun, loadNavApp, saveNavApp, saveRun } from './runStore';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const nowMin = (): number => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const NAV_LABEL: Record<NavApp, string> = { google: 'Google Maps', waze: 'Waze', apple: 'Apple Maps' };

export interface RunViewOptions {
  active: ActiveRun;
  store: KeyValueStore;
  providers: Providers | null;
  demo: boolean;
  onExit: () => void;
}

/**
 * Run Mode: one stop at a time. Every change is saved on the device straight away, so closing
 * the app or losing signal mid-route loses nothing. Navigation is handed to the driver's own
 * app one leg at a time (coordinates only).
 */
export async function mountRun(root: HTMLElement, o: RunViewOptions): Promise<void> {
  let a = o.active;
  let navApp = await loadNavApp(o.store);
  let message = '';
  let endArmed = false;

  root.innerHTML = `
    <section class="run">
      <div id="rnotices"></div>
      <p id="progress" class="progress"></p>
      <progress id="bar" max="1" value="0"></progress>
      <div id="map" class="map small" role="region" aria-label="${esc(t('review.map'))}"></div>
      <div id="main"></div>
    </section>`;
  const { createMap } = await import('../review/mapView');
  const map: RouteMap = createMap(root.querySelector<HTMLElement>('#map')!);
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;

  // Keep the screen awake while driving (best effort: not every browser allows it).
  let lock: { release: () => Promise<void> } | null = null;
  const keepAwake = async (): Promise<void> => {
    try {
      lock = (await (navigator as unknown as { wakeLock?: { request: (k: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')) ?? null;
    } catch { /* not allowed: ignore */ }
  };
  const onVisible = (): void => { if (document.visibilityState === 'visible') void keepAwake(); };
  document.addEventListener('visibilitychange', onVisible);
  void keepAwake();
  const leave = (): void => {
    document.removeEventListener('visibilitychange', onVisible);
    void lock?.release();
    map.destroy();
  };

  const persist = (): void => { void saveRun(o.store, a); };
  const addrOf = (k: number): string => {
    const st = a.run.items[k]!.stop;
    return [st.block, st.street].filter(Boolean).join(' ') || st.postal || '';
  };
  const posOf = (k: number): number => a.run.order.indexOf(k) + 1;

  const drawMap = (): void => {
    const cur = currentIndex(a);
    const pts: MapPoint[] = [{ position: a.run.depot, label: 'S', kind: 'depot' }];
    for (const k of a.run.order) {
      const it = a.run.items[k]!;
      const done = it.stop.status === 'delivered' || it.stop.status === 'failed';
      pts.push({
        position: it.place.position,
        label: done ? (it.stop.status === 'delivered' ? '✓' : '✗') : String(posOf(k)),
        kind: done ? 'done' : k === cur ? 'current' : it.place.gated ? 'gated' : 'stop',
      });
    }
    const rest = remaining(a);
    const line = [position(a), ...rest.map((k) => a.run.items[k]!.place.position)];
    const near = [position(a), ...rest.slice(0, 2).map((k) => a.run.items[k]!.place.position)];
    map.update(pts, line, true, near);
  };

  const render = (): void => {
    const total = a.run.items.length;
    const c = counts(a);
    const doneN = c.delivered + c.failed;
    const cur = currentIndex(a);
    $('#progress').textContent = cur === null ? t('run.finishedTitle') : t('run.progress', { n: doneN + 1, total });
    $<HTMLProgressElement>('#bar').value = total ? doneN / total : 0;
    $('#rnotices').innerHTML = [
      ...(o.demo ? [t('review.demo')] : []),
      ...(a.estimated ? [t('plan.notice.matrix-estimated')] : []),
    ].map((n) => `<p class="notice">${esc(n)}</p>`).join('');
    drawMap();
    $('#main').innerHTML = cur === null ? finishedHtml() : cardHtml(cur);
    bind(cur);
  };

  const cardHtml = (k: number): string => {
    const it = a.run.items[k]!;
    const st = it.stop;
    const sched = remainingSchedule(a, nowMin());
    const arrive = sched.arrive[st.id];
    const plan = a.planned[st.id];
    const drift = arrive !== undefined && plan !== undefined ? Math.round(arrive - plan) : 0;
    const dl = deadlineText(st);
    const late = arrive !== undefined && st.deadlineMin !== undefined && arrive > st.deadlineMin;
    const driftText = Math.abs(drift) < 5 ? t('run.drift.on') : drift > 0 ? t('run.drift.late', { min: drift }) : t('run.drift.early', { min: -drift });
    const flags = [
      it.place.gated ? `<span class="flag gate">${esc(t('resolve.gated'))}</span>` : '',
      st.status === 'skipped' ? `<span class="flag">${esc(t('run.revisit'))}</span>` : '',
      dl ? `<span class="flag ${late ? 'late' : 'due'}">${esc(t('inbox.by', { time: dl }))}</span>` : '',
      ...(a.flags[st.id] ?? []).map((f) => `<span class="flag">${esc(t(`resolve.flag.${f}`))}</span>`),
    ].join('');
    const tel = telHref(st.contact);
    const wa = whatsappHref(st.contact, arrive === undefined ? undefined : t('run.onTheWay', { time: clock(arrive) }));
    const nx = nextIndex(a);
    const rest = remaining(a).filter((x) => x !== k);
    const done = a.doneOrder;
    return `
      <article class="card">
        <div class="cardhead"><span class="num big">${posOf(k)}</span>
          <div><h2>${esc(addrOf(k))}</h2>
            <p class="unit">${esc(st.unit ?? '')} ${esc(st.postal ?? '')}</p>
            ${st.recipient ? `<p class="who">${esc(st.recipient)}</p>` : ''}</div></div>
        <div>${flags}</div>
        ${st.note ? `<p class="dropnote">${esc(st.note)}</p>` : ''}
        <p class="eta">${arrive === undefined ? '' : esc(t('run.eta', { time: clock(arrive) })) + ' · '}${esc(driftText)}</p>
        <div class="actions">
          <a id="nav" class="btn" href="${esc(navUrl(navApp, it.place.position))}" target="_blank" rel="noopener">${esc(t('run.navigate'))}</a>
          <select id="navApp" aria-label="${esc(t('run.navApp'))}">${NAV_APPS.map((n) => `<option value="${n}"${n === navApp ? ' selected' : ''}>${NAV_LABEL[n]}</option>`).join('')}</select>
          ${tel ? `<a class="btn ghost2" href="${esc(tel)}">${esc(t('run.call'))}</a>` : ''}
          ${wa ? `<a class="btn ghost2" href="${esc(wa)}" target="_blank" rel="noopener">${esc(t('run.whatsapp'))}</a>` : ''}
        </div>
        <input id="outNote" type="text" maxlength="200" placeholder="${esc(t('run.note'))}">
        <div class="outcomes">
          <button id="delivered" class="ok">${esc(t('run.delivered'))}</button>
          <button id="failed" class="bad">${esc(t('run.failed'))}</button>
          <button id="skip" class="ghost2">${esc(t('run.skip'))}</button>
        </div>
      </article>
      ${nx !== null ? `<p class="next">${esc(t('run.next', { addr: addrOf(nx) }))}</p>` : ''}
      <div class="controls">
        <button id="reopt" class="ghost2"${rest.length + 1 < 3 ? ' disabled' : ''}>${esc(t('run.reopt'))}</button>
        <button id="undo" class="ghost2"${done.length ? '' : ' disabled'}>${esc(t('run.undo'))}</button>
        <button id="end" class="ghost">${esc(endArmed ? t('run.endConfirm') : t('run.end'))}</button>
      </div>
      ${message ? `<p class="notice">${esc(message)}</p>` : ''}
      <details><summary>${esc(t('run.remaining', { n: rest.length + 1 }))}</summary>
        <ol class="mini">${[k, ...rest].map((x) => `<li>${posOf(x)}. ${esc(addrOf(x))}${a.run.items[x]!.stop.status === 'skipped' ? ' ↷' : ''}</li>`).join('')}</ol></details>
      ${done.length ? `<details><summary>${esc(t('run.done', { n: done.length }))}</summary>
        <ol class="mini">${done.map((x) => `<li>${a.run.items[x]!.stop.status === 'delivered' ? '✓' : '✗'} ${esc(addrOf(x))}${a.log[a.run.items[x]!.stop.id]?.note ? ` · ${esc(a.log[a.run.items[x]!.stop.id]!.note!)}` : ''}</li>`).join('')}</ol></details>` : ''}`;
  };

  const finishedHtml = (): string => {
    const c = counts(a);
    const failed = a.doneOrder.filter((k) => a.run.items[k]!.stop.status === 'failed');
    return `
      <article class="card">
        <h2>${esc(t('run.finishedTitle'))}</h2>
        <p class="eta">${esc(t('run.summary', { delivered: c.delivered, failed: c.failed }))}</p>
        ${failed.length ? `<ul class="mini">${failed.map((k) => `<li>✗ ${esc(addrOf(k))}${a.log[a.run.items[k]!.stop.id]?.note ? ` · ${esc(a.log[a.run.items[k]!.stop.id]!.note!)}` : ''}
          <button class="ghost2" data-retry="${k}">${esc(t('run.retry'))}</button></li>`).join('')}</ul>` : ''}
        <div class="outcomes">
          <button id="undo" class="ghost2">${esc(t('run.undo'))}</button>
          <button id="finishRun" class="ok">${esc(t('run.finish'))}</button>
          <button id="finishWipe" class="bad">${esc(t('run.finishWipe'))}</button>
        </div>
      </article>`;
  };

  const act = (next: ActiveRun): void => { a = next; message = ''; endArmed = false; persist(); render(); };

  const reoptimize = async (): Promise<void> => {
    const btn = $<HTMLButtonElement>('#reopt');
    btn.disabled = true;
    try {
      const r = remainingRun(a, nowMin());
      const inp = optimizeInputs(r.run, r.matrix);
      const plan = await planRoute({ ...inp.job, matrix: inp.matrix }, { hosted: o.providers?.optimizer });
      const here = inp.job.points.map((_, i) => i); // points are laid out in the current order
      const before = evaluate(inp.job, inp.matrix, here);
      const after = evaluate(inp.job, inp.matrix, plan.order);
      if (after.cost < before.cost - 1) {
        const subOrder = orderFromResult(inp, plan.order);
        a = applyRemainingOrder(a, r, subOrder);
        const saved = Math.max(0, Math.round((before.totalSec - after.totalSec) / 60));
        message = t('run.reopt.done', { min: saved });
      } else {
        message = t('run.reopt.same');
      }
      if (a.run.settings.end === 'round') message += ' ' + t('run.reopt.round');
      persist();
    } finally {
      render();
    }
  };

  const bind = (cur: number | null): void => {
    const main = $('#main');
    if (cur !== null) {
      const note = (): string => main.querySelector<HTMLInputElement>('#outNote')!.value.trim();
      $('#delivered').addEventListener('click', () => act(finish(a, cur, 'delivered', nowMin(), note() || undefined)));
      $('#failed').addEventListener('click', () => act(finish(a, cur, 'failed', nowMin(), note() || undefined)));
      $('#skip').addEventListener('click', () => act(skip(a, cur)));
      $('#reopt').addEventListener('click', () => void reoptimize());
      $('#navApp').addEventListener('change', (e) => {
        navApp = (e.target as HTMLSelectElement).value as NavApp;
        void saveNavApp(o.store, navApp);
        $<HTMLAnchorElement>('#nav').href = navUrl(navApp, a.run.items[cur]!.place.position);
      });
      $('#end').addEventListener('click', () => {
        if (!endArmed) { endArmed = true; render(); return; }
        void clearRun(o.store).then(() => { leave(); o.onExit(); });
      });
    } else {
      $('#finishRun').addEventListener('click', () => void clearRun(o.store).then(() => { leave(); o.onExit(); }));
      $('#finishWipe').addEventListener('click', () => void wipeAll(o.store).then(() => { leave(); o.onExit(); }));
      main.querySelectorAll<HTMLElement>('[data-retry]').forEach((b) => b.addEventListener('click', () => act(retry(a, Number(b.dataset.retry)))));
    }
    main.querySelector('#undo')?.addEventListener('click', () => act(undoLast(a)));
  };

  persist();
  render();
}

