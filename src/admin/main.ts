/**
 * Owner console. Sign in with the admin token (kept in memory only, gone when the tab closes).
 * All text from drivers is written with textContent, never as HTML.
 */
import { API_BASE } from '../app/config';

type Row = Record<string, unknown>;
let token = '';
const root = document.getElementById('admin')!;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) n.className = cls;
  Object.assign(n, rest);
  n.append(...kids);
  return n;
};

async function api(path: string, body?: unknown): Promise<Row> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (res.status === 401 || res.status === 404) throw new Error('Not signed in (check the admin token).');
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as Row;
}

const button = (label: string, onClick: () => Promise<unknown>, cls = ''): HTMLButtonElement => {
  const b = el('button', { textContent: label, class: cls });
  b.addEventListener('click', () => { b.disabled = true; void onClick().then(() => load(), (e: unknown) => alert(String(e))); });
  return b;
};

const section = (title: string, rows: Row[], line: (r: Row) => string, actions: (r: Row) => HTMLElement[]): HTMLElement =>
  el('section', {}, el('h2', { textContent: `${title} (${rows.length})` }),
    ...(rows.length ? rows.map((r) => el('div', { class: 'row' }, el('span', { textContent: line(r) }), ...actions(r))) : [el('p', { textContent: 'Nothing waiting.', class: 'muted' })]));

async function load(): Promise<void> {
  try {
    const [o, reports, gates, notes, fb] = await Promise.all([
      api('/admin/overview'), api('/admin/reports'), api('/admin/gates'), api('/admin/notes?status=flagged'), api('/admin/feedback?status=new'),
    ]);
    const open = o.open as Record<string, number>;
    const kill = el('input', { value: String(o.kill ?? ''), placeholder: 'e.g. ors,overpass,onemap' });
    const banner = el('input', { value: String(o.banner ?? ''), placeholder: 'Message shown to all drivers', maxLength: 200 });
    const cap = el('input', { type: 'number', value: String(o.orsCap ?? 400), min: '0', max: '5000' });
    const gateForm = {
      postals: el('input', { placeholder: 'Postal codes, comma separated' }),
      lat: el('input', { placeholder: 'Latitude' }), lng: el('input', { placeholder: 'Longitude' }), name: el('input', { placeholder: 'Development name' }),
    };
    root.replaceChildren(
      el('h1', { textContent: 'Route Mapper SG · Admin' }),
      el('p', { textContent: `Routing today: ${String(o.ors)} of ${String(o.orsCap)} · waiting: ${open.reports} reports, ${open.flaggedNotes} flagged tips, ${open.newFeedback} feedback` }),
      el('section', {}, el('h2', { textContent: 'Switches' }),
        el('label', {}, 'Turn off (comma list: onemap, overpass, ors, community)', kill),
        el('label', {}, 'Banner', banner), el('label', {}, 'Daily routing cap', cap),
        button('Save', () => api('/admin/settings', { kill: kill.value.trim(), banner: banner.value.trim(), orsDailyCap: Number(cap.value) }))),
      section('Open reports', reports.reports as Row[], (r) => `${String(r.kind)} · ${(r.postals as string[]).join(', ')} · ${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`,
        (r) => [button('Reject', () => api('/admin/report/reject', { id: r.id }))]),
      section('Gates', gates.gates as Row[], (g) => `${g.gated ? 'gate' : 'pin'} · ${String(g.name ?? '')} ${(g.postals as string[]).join(', ')} · ${String(g.source)} · ${String(g.status)}`,
        (g) => [button(g.status === 'hidden' ? 'Show' : 'Hide', () => api('/admin/gate/status', { id: g.id, status: g.status === 'hidden' ? 'verified' : 'hidden' }))]),
      section('Flagged tips', notes.notes as Row[], (n) => `${String(n.postal)} · ${String(n.body)} · ${String(n.flags)} reports`,
        (n) => [button('Keep', () => api('/admin/note/status', { id: n.id, status: 'visible' })), button('Hide', () => api('/admin/note/status', { id: n.id, status: 'hidden' }))]),
      section('New feedback', fb.feedback as Row[], (f) => `${String(f.kind)}${f.rating ? ` ${String(f.rating)}★` : ''} · ${String(f.message ?? '')}`,
        (f) => [button('Done', () => api('/admin/feedback/status', { id: f.id, status: 'done' }))]),
      el('section', {}, el('h2', { textContent: 'Add or lock a gate' }), ...Object.values(gateForm),
        button('Save gate (never auto-replaced)', () => api('/admin/gate', {
          postals: gateForm.postals.value.split(',').map((p) => p.trim()).filter(Boolean), lat: Number(gateForm.lat.value), lng: Number(gateForm.lng.value), name: gateForm.name.value.trim(), gated: true,
        }))),
    );
  } catch (e) {
    signIn(e instanceof Error ? e.message : '');
  }
}

function signIn(error = ''): void {
  const input = el('input', { type: 'password', placeholder: 'Admin token', autocomplete: 'off' });
  const go = el('button', { textContent: 'Sign in' });
  go.addEventListener('click', () => { token = input.value.trim(); void load(); });
  root.replaceChildren(el('h1', { textContent: 'Admin' }), error ? el('p', { textContent: error, class: 'muted' }) : '', input, go);
}

const style = el('style', { textContent: 'body{font:15px system-ui;margin:1rem auto;max-width:720px;padding:0 1rem}.row{display:flex;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding:6px 0}.row span{overflow-wrap:anywhere}input{display:block;width:100%;margin:4px 0;padding:6px;box-sizing:border-box}.muted{color:#64748b}button{padding:6px 10px}' });
document.head.append(style);
signIn();
