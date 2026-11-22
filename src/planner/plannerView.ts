import type { LatLng, Stop } from '../domain/types';
import { t } from '../i18n';
import { sendFeedback, type FeedbackKind } from '../app/community';
import { loadResolutions, saveResolutions, type ResolutionCache } from '../app/resolvedStore';
import { resolveAll, type Resolved } from '../app/resolveAll';
import {
  chooseDepot, loadStart, locate, needsRefresh, saveStart, startFromPostal, type StartPoint,
} from '../app/start';
import { dedup } from '../inbox/dedup';
import { loadInbox, saveInbox, wipeAll } from '../inbox/inboxStore';
import { parseCsv } from '../inbox/parseCsv';
import { parseText } from '../inbox/parseText';
import { parseXlsxFile } from '../inbox/parseXlsx';
import type { KeyValueStore, Providers } from '../providers/types';
import type { MapPoint, RouteMap } from '../review/mapView';
import { clock } from '../review/model';
import { inOrder, pendingCount, preview, rowStatus } from './thread';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface PlanRequest {
  resolved: Resolved[];
  depot: LatLng;
  /** False when no start was set and the route begins at the first stop. */
  startKnown: boolean;
  demo: boolean;
}

export interface PlannerOptions {
  store: KeyValueStore;
  providers: Providers | null;
  banner: string | null;
  /** Text shared into the app (Android Share), put in the message box, not sent anywhere. */
  prefill: string;
  onPlan: (plan: PlanRequest) => void;
}

type Entry =
  | { k: 'app'; text: string }
  | { k: 'me'; text: string }
  | { k: 'added'; title: string; ids: string[]; notes: string[] };

let seq = 0;
const newId = (): string => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
const hhmm = (min: number): string => clock(min);

/**
 * The home screen: a chat. The driver pastes or types stops like messages; each stop is looked up
 * and pinned as soon as it is sent, and the map fills in live. Planning only has to optimize.
 * Everything personal stays in IndexedDB; lookups send postal codes only.
 */
export async function mountPlanner(root: HTMLElement, o: PlannerOptions): Promise<void> {
  const { store, providers } = o;
  const demo = providers === null;
  let stops: Stop[] = await loadInbox(store);
  const done = new Map<string, Resolved>();
  for (const [id, c] of Object.entries(await loadResolutions(store, stops.map((s) => s.id)))) {
    const stop = stops.find((s) => s.id === id);
    if (stop) done.set(id, { stop, place: c.place, flags: c.flags });
  }
  let start: StartPoint | undefined = await loadStart(store);
  const entries: Entry[] = [];
  const inflight = new Set<string>();
  const batches: Promise<unknown>[] = [];
  let feedbackMode = false;
  let feedbackKind: FeedbackKind = 'bug';
  let mapShown = true;
  let busy = '';

  root.innerHTML = `
    <section class="planner">
      <header class="topbar">
        <div class="brand"><b>${esc(t('app.name'))}</b><span>${esc(t('app.tagline'))}</span></div>
        <details class="menu"><summary aria-label="${esc(t('chat.menu'))}">⋯</summary>
          <div class="menu-pop"><button id="wipe" class="menu-item danger">${esc(t('inbox.wipe'))}</button></div></details>
      </header>
      ${o.banner ? `<p class="banner" role="status">${esc(o.banner)}</p>` : ''}
      <div id="resume"></div>
      <button id="startChip" class="chip" aria-expanded="false" aria-controls="startPanel"></button>
      <div id="startPanel" class="panel" hidden>
        <p class="panel-title">${esc(t('start.title'))}</p>
        <button id="useGps" class="primary wide">📍 ${esc(t('start.use'))}</button>
        ${demo ? '' : `<p class="hint center">${esc(t('start.orPostal'))}</p>
        <div class="inline"><input id="startPostal" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="postal-code" placeholder="123456" aria-label="${esc(t('start.postal'))}"><button id="setPostal" class="ghost2">${esc(t('start.setBtn'))}</button></div>`}
        <p id="startMsg" class="hint" role="status"></p>
        <p class="hint">${esc(t('start.privacy'))}</p>
      </div>
      <div id="mapwrap" class="mapwrap" hidden>
        <div id="pmap" class="map" role="region" aria-label="${esc(t('review.map'))}"></div>
        <button id="mapToggle" class="maptoggle ghost2" aria-expanded="true">${esc(t('chat.map.hide'))}</button>
      </div>
      <div id="thread" class="thread" role="log" aria-live="polite"></div>
      <div class="dock">
        <div id="kinds" class="kinds" hidden>
          <button class="chipbtn" data-kind="bug" aria-pressed="true">${esc(t('feedback.bug'))}</button>
          <button class="chipbtn" data-kind="idea" aria-pressed="false">${esc(t('feedback.idea'))}</button>
        </div>
        <div class="composer">
          <label class="iconbtn" aria-label="${esc(t('chat.attach'))}" title="${esc(t('chat.attach'))}">📎<input id="file" type="file" accept=".csv,.xlsx" hidden></label>
          ${providers ? `<button id="mode" class="iconbtn" aria-pressed="false" aria-label="${esc(t('feedback.open'))}" title="${esc(t('feedback.open'))}">💬</button>` : ''}
          <textarea id="msg" rows="1" maxlength="6000" enterkeyhint="send" autocomplete="off" aria-label="${esc(t('chat.placeholder'))}"></textarea>
          <button id="send" class="send" aria-label="${esc(t('chat.send'))}">➤</button>
        </div>
        <button id="plan" class="primary wide plan" disabled></button>
      </div>
    </section>`;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const msg = $<HTMLTextAreaElement>('#msg');
  msg.placeholder = t('chat.placeholder');

  // ---- map (loaded the first time a stop is pinned) ----
  let map: RouteMap | null = null;
  let mapLoading = false;
  const drawMap = async (): Promise<void> => {
    const pts: MapPoint[] = [];
    if (start) pts.push({ position: start.position, label: 'S', kind: 'depot' });
    stops.forEach((s, i) => {
      const r = done.get(s.id);
      if (!r?.place) return;
      pts.push({
        position: r.place.position, label: String(i + 1), kind: r.place.gated ? 'gated' : 'stop',
        ...(s.deadlineMin !== undefined ? { due: { time: hhmm(s.deadlineMin), state: 'plain' as const } } : {}),
      });
    });
    $('#mapwrap').hidden = pts.length === 0;
    if (pts.length === 0 || mapLoading) return;
    if (!map) {
      mapLoading = true;
      const { createMap } = await import('../review/mapView');
      map = createMap($('#pmap'));
      mapLoading = false;
    }
    map.update(pts, [], true);
  };

  // ---- thread ----
  const statusHtml = (s: Stop): string => {
    const st = rowStatus(done.get(s.id));
    const label = {
      finding: `<span class="spin" aria-hidden="true"></span>${esc(t('status.finding'))}`,
      pinned: `✓ ${esc(t('status.pinned'))}`,
      gated: `🔒 ${esc(t('status.gated'))}`,
      check: `⚠ ${esc(t('status.check'))}`,
      notfound: `✗ ${esc(t('status.notfound'))}`,
    }[st.state];
    const flags = st.flags.map((f) => `<span class="flag">${esc(t(`resolve.flag.${f}`))}</span>`).join('');
    const retry = st.state === 'notfound' ? `<button class="link" data-retry="${esc(s.id)}">${esc(t('chat.retry'))}</button>` : '';
    return `<div class="rowstatus ${st.state}">${label} ${retry}</div>${flags}`;
  };

  const stopRow = (s: Stop): string => {
    const n = stops.indexOf(s) + 1;
    const addr = [s.block, s.street].filter(Boolean).join(' ') || s.postal || '';
    const sub = [s.unit, s.postal, s.recipient].filter(Boolean).join(' · ');
    const flags = s.flags.map((f) => `<span class="flag">${esc(t(`inbox.flag.${f}`))}</span>`).join('');
    const due = s.deadlineMin !== undefined ? `<span class="flag due">⏰ ${esc(t('due.by', { time: hhmm(s.deadlineMin) }))}</span>` : '';
    return `<li class="srow"><span class="num">${n}</span>
      <div class="body"><b>${esc(addr)}</b><div class="sub">${esc(sub)}</div>${statusHtml(s)}${due}${flags}</div>
      <button class="del" data-del="${esc(s.id)}" aria-label="${esc(t('chat.remove'))}">✕</button></li>`;
  };

  const renderThread = (): void => {
    const el = $('#thread');
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const body = entries.map((e) => {
      if (e.k === 'me') return `<div class="bubble me">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
      if (e.k === 'app') return `<div class="bubble app">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
      const rows = e.ids.map((id) => stops.find((s) => s.id === id)).filter((s): s is Stop => !!s);
      const notes = e.notes.length ? `<p class="ignored">${esc(t('inbox.ignored'))}<br>${e.notes.map(esc).join('<br>')}</p>` : '';
      return `<div class="bubble app wide-b"><p class="btitle">${esc(e.title)}</p><ol class="srows">${rows.map(stopRow).join('')}</ol>${notes}</div>`;
    }).join('');
    el.innerHTML = body;
    if (stick) el.scrollTop = el.scrollHeight;
  };

  const renderPlan = (): void => {
    const btn = $<HTMLButtonElement>('#plan');
    const pending = pendingCount(stops, done);
    btn.disabled = stops.length === 0 || busy !== '';
    btn.setAttribute('aria-busy', String(busy !== ''));
    btn.innerHTML = busy
      ? `<span class="spin light" aria-hidden="true"></span>${esc(busy)}`
      : stops.length === 0 ? esc(t('plan.empty'))
        : esc(t('plan.button', { n: stops.length })) + (pending ? ` · ${esc(t('plan.finding', { n: pending }))}` : '');
  };

  const renderStart = (): void => {
    const chip = $('#startChip');
    chip.textContent = start
      ? `📍 ${start.source === 'gps' ? t('start.gps') : t('start.postal', { postal: start.postal ?? '' })}`
      : `📍 ${t('start.set')}`;
    chip.classList.toggle('needs', !start);
  };

  const redraw = (): void => { renderThread(); renderPlan(); void drawMap(); };

  // ---- lookups ----
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cache: ResolutionCache = {};
      for (const [id, r] of done) if (r.place) cache[id] = { place: r.place, flags: r.flags };
      void saveResolutions(store, cache);
    }, 300);
  };

  const lookup = (list: Stop[]): void => {
    const todo = list.filter((s) => !done.has(s.id) && !inflight.has(s.id));
    if (todo.length === 0) return;
    todo.forEach((s) => inflight.add(s.id));
    batches.push(
      resolveAll(todo, providers, undefined, undefined, (r) => {
        inflight.delete(r.stop.id);
        if (!stops.some((s) => s.id === r.stop.id)) return; // removed while it was being looked up
        done.set(r.stop.id, r);
        persist();
        redraw();
      }).catch(() => {
        // Never leave a row spinning: anything not answered is shown as not found, with Try again.
        for (const s of todo) if (!done.has(s.id)) { inflight.delete(s.id); done.set(s.id, { stop: s, place: null, flags: ['not-found'] }); }
        redraw();
      }),
    );
    redraw();
  };

  // ---- adding stops ----
  const addStops = async (incoming: Stop[], notes: string[], title: string): Promise<void> => {
    const r = dedup([...stops, ...incoming]);
    stops = r.stops;
    await saveInbox(store, stops);
    const ids = incoming.map((s) => s.id).filter((id) => stops.some((s) => s.id === id));
    const merged = r.merged ? [t('inbox.merged', { n: r.merged })] : [];
    if (ids.length === 0 && r.merged === 0) {
      entries.push({ k: 'app', text: `${t('chat.noStops')}${notes.length ? `\n${notes.join('\n')}` : ''}` });
    } else {
      entries.push({ k: 'added', title, ids, notes: [...merged, ...notes] });
    }
    redraw();
    lookup(stops);
  };

  const submit = async (): Promise<void> => {
    const text = msg.value.trim();
    if (!text) return;
    msg.value = '';
    grow();
    entries.push({ k: 'me', text: preview(text) });
    if (feedbackMode) {
      const result = await sendFeedback(store, { kind: feedbackKind, message: text });
      entries.push({ k: 'app', text: t(result === 'queued' ? 'fix.queued' : result === 'rejected' ? 'fix.noteRejected' : 'feedback.thanks') });
      redraw();
      return;
    }
    const p = parseText(text, newId);
    await addStops(p.stops, p.ignored, t('chat.added', { n: p.stops.length }));
  };

  const importFile = async (file: File): Promise<void> => {
    entries.push({ k: 'me', text: `📎 ${file.name}` });
    const r = /\.xlsx$/i.test(file.name) ? await parseXlsxFile(file) : parseCsv(await file.text(), newId);
    const notes = [
      ...r.unmappedColumns.map((c) => t('inbox.unmapped', { col: c })),
      ...r.skippedRows.map((n) => t('inbox.skipped', { row: n })),
    ];
    await addStops(r.stops, notes, t('chat.added', { n: r.stops.length }));
  };

  // ---- start point ----
  const startMsg = (key: string): void => { $('#startMsg').textContent = key ? t(key) : ''; };
  const setStartPanel = (open: boolean): void => {
    $('#startPanel').hidden = !open;
    $('#startChip').setAttribute('aria-expanded', String(open));
  };
  const useGps = async (): Promise<boolean> => {
    startMsg('start.locating');
    const g = await locate();
    if (!g.ok) { startMsg(g.reason === 'denied' ? 'start.denied' : g.reason === 'outside' ? 'start.outside' : 'start.unavailable'); return false; }
    start = { position: g.position, source: 'gps', at: Date.now() };
    await saveStart(store, start);
    startMsg('');
    renderStart();
    void drawMap();
    return true;
  };

  // ---- planning ----
  const plan = async (): Promise<void> => {
    if (stops.length === 0 || busy) return;
    busy = pendingCount(stops, done) ? t('plan.finding', { n: pendingCount(stops, done) }) : t('plan.locating');
    renderPlan();
    await Promise.allSettled(batches);
    if (needsRefresh(start) && start?.source !== 'postal') {
      busy = t('plan.locating');
      renderPlan();
      await useGps(); // on failure the saved start (if any) is kept
    }
    busy = '';
    const resolved = inOrder(stops, done);
    const first = resolved.find((r) => r.place)?.place?.position;
    const d = chooseDepot(start, first);
    if (!d) {
      entries.push({ k: 'app', text: t('plan.noPlaced') });
      redraw();
      return;
    }
    renderPlan();
    o.onPlan({ resolved, depot: d.depot, startKnown: d.known, demo });
  };

  // ---- events ----
  const grow = (): void => {
    msg.style.height = 'auto';
    msg.style.height = `${Math.min(msg.scrollHeight, 160)}px`;
  };
  msg.addEventListener('input', grow);
  msg.addEventListener('keydown', (e) => {
    // Desktop: Enter sends, Shift+Enter adds a line. Phones: Enter is a new line (pasted lists have many); use the button.
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void submit(); }
  });
  $('#send').addEventListener('click', () => void submit());
  $('#plan').addEventListener('click', () => void plan());
  $('#file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void importFile(file);
  });
  $('#mapToggle').addEventListener('click', () => {
    mapShown = !mapShown;
    $('#pmap').hidden = !mapShown;
    const b = $('#mapToggle');
    b.textContent = t(mapShown ? 'chat.map.hide' : 'chat.map.show');
    b.setAttribute('aria-expanded', String(mapShown));
    if (mapShown) map?.resize();
  });
  $('#thread').addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const del = target.closest<HTMLElement>('[data-del]')?.dataset.del;
    const retry = target.closest<HTMLElement>('[data-retry]')?.dataset.retry;
    if (del) {
      stops = stops.filter((s) => s.id !== del);
      done.delete(del);
      void saveInbox(store, stops);
      persist();
      redraw();
    } else if (retry) {
      done.delete(retry);
      redraw();
      lookup(stops);
    }
  });
  $('#startChip').addEventListener('click', () => setStartPanel(Boolean($('#startPanel').hidden)));
  $('#useGps').addEventListener('click', () => void useGps().then((ok) => { if (ok) setStartPanel(false); }));
  root.querySelector('#setPostal')?.addEventListener('click', () => {
    const postal = $<HTMLInputElement>('#startPostal').value.trim();
    if (!/^\d{6}$/.test(postal)) return startMsg('start.badPostal');
    startMsg('start.locating');
    void startFromPostal(providers!.geocoder, postal).then(async (s) => {
      if (!s) return startMsg('start.notFound');
      start = s;
      await saveStart(store, s);
      startMsg('');
      renderStart();
      setStartPanel(false);
      void drawMap();
    }).catch(() => startMsg('start.unavailable'));
  });
  root.querySelector('#mode')?.addEventListener('click', () => {
    feedbackMode = !feedbackMode;
    const b = $('#mode');
    b.setAttribute('aria-pressed', String(feedbackMode));
    b.classList.toggle('on', feedbackMode);
    $('#kinds').hidden = !feedbackMode;
    msg.placeholder = t(feedbackMode ? 'feedback.placeholder' : 'chat.placeholder');
    msg.focus();
  });
  root.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    feedbackKind = b.dataset.kind as FeedbackKind;
    root.querySelectorAll<HTMLElement>('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  $('#wipe').addEventListener('click', async () => {
    if (!window.confirm(t('inbox.wipe.confirm'))) return;
    await wipeAll(store);
    stops = [];
    start = undefined;
    done.clear();
    entries.length = 0;
    entries.push({ k: 'app', text: t('chat.welcome') });
    root.querySelector<HTMLDetailsElement>('.menu')!.open = false;
    renderStart();
    redraw();
  });

  // ---- first paint ----
  entries.push({ k: 'app', text: t('chat.welcome') });
  if (stops.length) entries.push({ k: 'added', title: t('chat.saved', { n: stops.length }), ids: stops.map((s) => s.id), notes: [] });
  renderStart();
  redraw();
  lookup(stops);
  if (o.prefill) { msg.value = o.prefill; grow(); msg.focus(); }
  // A start from earlier today is reused; a stale GPS start is refreshed quietly when the browser already allows location.
  if (needsRefresh(start) && start?.source !== 'postal') {
    void (navigator.permissions?.query({ name: 'geolocation' }).then((p) => { if (p.state === 'granted') void useGps(); }).catch(() => undefined));
  }
}
