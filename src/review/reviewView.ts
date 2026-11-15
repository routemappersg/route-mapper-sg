import { t } from '../i18n';
import { planRoute } from '../optimize/plan';
import { straightLineMatrix } from '../optimize/evaluate';
import type { Providers, TimeMatrix } from '../providers/types';
import type { Resolved } from '../app/resolveAll';
import type { MapPoint, RouteMap } from './mapView';
import {
  buildJob, clock, DEFAULT_SETTINGS, deadlineText, moveStop, optimizeInputs, orderFromResult, schedule, toggleLock,
  type Run, type RunItem,
} from './model';
import type { LatLng } from '../domain/types';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface ReviewOptions {
  resolved: Resolved[];
  depot: LatLng;
  demo: boolean;
  providers: Providers | null;
  onBack: () => void;
}

/**
 * Map + list. Dragging, locking and time changes recompute arrival times from the cached
 * matrix: no network call. Optimize is the only action that may call a provider (once).
 */
export async function mountReview(root: HTMLElement, o: ReviewOptions): Promise<void> {
  const placed = o.resolved.filter((r): r is Resolved & { place: NonNullable<Resolved['place']> } => r.place !== null);
  const unplaced = o.resolved.filter((r) => r.place === null);
  const items: RunItem[] = placed.map((r) => ({ stop: r.stop, place: r.place, locked: false }));
  let run: Run = { depot: o.depot, items, settings: { ...DEFAULT_SETTINGS }, order: items.map((_, i) => i) };
  let matrix: TimeMatrix = straightLineMatrix(buildJob(run).points);
  let notices: string[] = o.demo ? [t('review.demo')] : [];
  let outlierHtml = '';

  root.innerHTML = `
    <section class="review">
      <div class="row"><button id="back" class="ghost2">${esc(t('review.back'))}</button></div>
      <div id="notices"></div>
      <div id="map" class="map" role="region" aria-label="${esc(t('review.map'))}"></div>
      <div class="controls">
        <label>${esc(t('review.start'))} <input id="startTime" type="time" value="${clock(run.settings.startMin)}"></label>
        <label>${esc(t('review.stopMin'))} <input id="stopMin" type="number" min="0" max="60" value="${run.settings.stopSec / 60}"></label>
        <label><input id="round" type="checkbox"> ${esc(t('review.round'))}</label>
        <button id="optimize">${esc(t('review.optimize'))}</button>
      </div>
      <p id="summary" class="summary"></p>
      <div id="outliers"></div>
      <ol id="list" class="stops"></ol>
      <div id="unplaced"></div>
    </section>`;

  // The map library is large: load it only when this screen opens.
  const { createMap } = await import('./mapView');
  const map: RouteMap = createMap(root.querySelector<HTMLElement>('#map')!);
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;

  const render = (fit = false): void => {
    const s = schedule(run, matrix);
    const pts: MapPoint[] = [{ position: run.depot, label: 'S', kind: 'depot' }, ...s.rows.map((r): MapPoint => ({
      position: r.item.place.position, label: String(r.n), kind: r.lateMin > 0 ? 'late' : r.item.place.gated ? 'gated' : 'stop', locked: r.item.locked,
    }))];
    map.update(pts, pts.map((p) => p.position), fit);
    $('#summary').textContent = t('review.summary', { n: s.rows.length, min: Math.round(s.totalMin), km: s.totalKm.toFixed(1), end: clock(s.finishMin) });
    $('#notices').innerHTML = notices.map((n) => `<p class="notice">${esc(n)}</p>`).join('');
    $('#outliers').innerHTML = outlierHtml;
    $('#list').innerHTML = s.rows.map((r) => {
      const st = r.item.stop;
      const addr = [st.block, st.street].filter(Boolean).join(' ');
      const dl = deadlineText(st);
      const flags = [
        r.item.place.gated ? `<span class="flag gate">${esc(t('resolve.gated'))}</span>` : '',
        dl ? `<span class="flag due">${esc(t('inbox.by', { time: dl }))}</span>` : '',
        r.lateMin > 0 ? `<span class="flag late">${esc(t('review.late', { min: Math.round(r.lateMin) }))}</span>` : '',
        ...(o.resolved.find((x) => x.stop.id === st.id)?.flags ?? []).map((f) => `<span class="flag">${esc(t(`resolve.flag.${f}`))}</span>`),
      ].join('');
      return `<li data-pos="${r.n - 1}" data-locked="${r.item.locked}">
        <span class="grip" data-grip aria-label="${esc(t('review.drag'))}">⠿</span>
        <span class="num">${r.n}</span>
        <div class="body"><b>${esc(addr)}</b> ${esc(st.unit ?? '')} ${esc(st.postal ?? '')}
          <div class="sub">${esc(clock(r.arriveMin))} · ${esc(t('review.leg', { min: Math.round(r.legMin) }))}${st.recipient ? ` · ${esc(st.recipient)}` : ''}</div>${flags}</div>
        <button class="lock" data-lock="${r.itemIndex}" aria-pressed="${r.item.locked}" aria-label="${esc(t('review.lock'))}">${r.item.locked ? '🔒' : '🔓'}</button>
      </li>`;
    }).join('');
    $('#unplaced').innerHTML = unplaced.length
      ? `<p class="ignored">${esc(t('review.unplaced', { n: unplaced.length }))}<br>${unplaced.map((u) => esc([u.stop.block, u.stop.street, u.stop.postal].filter(Boolean).join(' '))).join('<br>')}</p>`
      : '';
  };

  // Drag a row by its grip (pointer events: works with touch and mouse).
  const list = $('#list');
  list.addEventListener('pointerdown', (e) => {
    const grip = (e.target as HTMLElement).closest('[data-grip]');
    const li = grip?.closest('li');
    if (!grip || !li || li.dataset.locked === 'true') return;
    e.preventDefault();
    const from = Number(li.dataset.pos);
    let to = from;
    li.classList.add('dragging');
    const move = (ev: PointerEvent): void => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('li');
      if (over && list.contains(over)) to = Number((over as HTMLElement).dataset.pos);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      run = { ...run, order: moveStop(run, from, to) };
      outlierHtml = '';
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-lock]');
    if (b) { run = toggleLock(run, Number(b.dataset.lock)); render(); }
  });
  $('#startTime').addEventListener('change', (e) => {
    const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number);
    run = { ...run, settings: { ...run.settings, startMin: (h ?? 0) * 60 + (m ?? 0) } };
    render();
  });
  $('#stopMin').addEventListener('change', (e) => {
    run = { ...run, settings: { ...run.settings, stopSec: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) * 60 } };
    render();
  });
  $('#round').addEventListener('change', (e) => {
    run = { ...run, settings: { ...run.settings, end: (e.target as HTMLInputElement).checked ? 'round' : 'last' } };
    render();
  });
  $('#back').addEventListener('click', () => { map.destroy(); o.onBack(); });

  const optimize = async (): Promise<void> => {
    const btn = $<HTMLButtonElement>('#optimize');
    btn.disabled = true;
    const keys: string[] = [];
    try {
      // One road-matrix call per plan (kept for every later drag). Fall back to estimates.
      if (o.providers) {
        try {
          matrix = await o.providers.router.matrix(buildJob(run).points);
        } catch {
          keys.push('matrix-estimated');
        }
      }
      // Points are laid out in the current visit order so locked stops keep their slot.
      const inp = optimizeInputs(run, matrix);
      const plan = await planRoute({ ...inp.job, matrix: inp.matrix }, { hosted: o.providers?.optimizer });
      run = { ...run, order: orderFromResult(inp, plan.order) };
      keys.push(...plan.notices);
      notices = [...(o.demo ? [t('review.demo')] : []), ...[...new Set(keys)].map((n) => t(`plan.notice.${n}`))];
      const out = plan.outliers;
      const pos = (p: number): number => positionOf(run, inp.itemOf[p]!);
      const lines = [...(out.pair ? [out.pair] : []), ...out.singles].slice(0, 2).map((x) => {
        const [a, b] = x.stops;
        const text = b === undefined
          ? t('plan.outlier.single', { stop: pos(a!), min: Math.round(x.savedSec / 60) })
          : t('plan.outlier.pair', { a: pos(a!), b: pos(b), min: Math.round(x.savedSec / 60) });
        return esc(text) + (x.deadlinesRescued ? ' ' + esc(t('plan.outlier.rescued', { n: x.deadlinesRescued })) : '');
      });
      outlierHtml = out.impractical ? `<div class="outlier"><b>${esc(t('plan.outlier.title'))}</b><br>${lines.join('<br>')}</div>` : '';
    } finally {
      btn.disabled = false;
      render();
    }
  };
  $('#optimize').addEventListener('click', () => void optimize());

  render(true);
}

/** Position (1-based) of an item on the current route. */
function positionOf(run: Run, itemIndex: number): number {
  return run.order.indexOf(itemIndex) + 1;
}
