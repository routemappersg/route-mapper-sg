import './styles.css';
import { detectLocale, setLocale, t } from './i18n';
import { flushOutbox, sendFeedback, type FeedbackKind } from './app/community';
import { buildProviders, loadServerConfig } from './app/config';
import { resolveAll } from './app/resolveAll';
import { mountInbox } from './inbox/inboxView';
import { DEMO_START } from './providers/demo';
import { idbStore } from './providers/idbStore';
import { mountReview } from './review/reviewView';
import { counts, startRun, type ActiveRun } from './run/model';
import { loadRun, saveRun } from './run/runStore';
import { mountRun } from './run/runView';
import type { Stop } from './domain/types';
import type { Providers } from './providers/types';

setLocale(detectLocale(navigator.language));

/** Text shared into the app (Android "Share" -> Route Mapper) arrives as ?text=... and is shown, not sent anywhere. */
function sharedText(): string {
  const p = new URLSearchParams(location.search);
  const text = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n');
  if (text) history.replaceState(null, '', location.pathname);
  return text;
}

const store = idbStore();
const root = document.getElementById('app');

const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function showInbox(prefill = ''): void {
  if (!root) return;
  root.innerHTML = `
    <main class="shell">
      <h1>${t('app.name')}</h1>
      <p class="tagline">${t('app.tagline')}</p>
      ${banner ? `<p class="banner" role="status">${escapeHtml(banner)}</p>` : ''}
      <div id="inbox"></div>
      ${providers ? `<details class="fix feedback"><summary>${t('feedback.open')}</summary>
        <p class="hint">${t('feedback.title')}</p>
        <select id="fbKind"><option value="bug">${t('feedback.bug')}</option><option value="idea">${t('feedback.idea')}</option></select>
        <textarea id="fbText" rows="3" maxlength="1000" placeholder="${t('feedback.placeholder')}"></textarea>
        <button id="fbSend" class="ghost2">${t('feedback.send')}</button><p id="fbDone" class="hint"></p></details>` : ''}
      <footer>${t('credits.map')}</footer>
    </main>`;
  document.getElementById('fbSend')?.addEventListener('click', () => {
    const text = (document.getElementById('fbText') as HTMLTextAreaElement).value.trim();
    if (!text) return;
    const kind = (document.getElementById('fbKind') as HTMLSelectElement).value as FeedbackKind;
    void sendFeedback(store, { kind, message: text }).then(() => {
      (document.getElementById('fbText') as HTMLTextAreaElement).value = '';
      const done = document.getElementById('fbDone');
      if (done) done.textContent = t('feedback.thanks');
    });
  });
  const inbox = document.getElementById('inbox');
  if (inbox) void mountInbox(inbox, store, prefill, (stops) => void showReview(stops));
  // A run in progress survives closing the app: offer to pick it up.
  void loadRun(store).then((active) => {
    if (!active || !inbox) return;
    const c = counts(active);
    const box = document.createElement('div');
    box.className = 'resume';
    box.innerHTML = `<button id="resume" class="primary">${t('run.resume', { n: c.delivered + c.failed, total: active.run.items.length })}</button>`;
    inbox.before(box);
    box.querySelector('#resume')?.addEventListener('click', () => void showRun(active));
  });
}

// With VITE_API_BASE set the app uses the Worker; without it, clearly-labelled demo positions.
let providers: Providers | null = null;
let banner: string | null = null;
const ready = loadServerConfig().then((cfg) => {
  providers = cfg ? buildProviders(store, cfg) : null;
  banner = cfg?.banner ?? null;
  if (providers) void flushOutbox(store);
});

async function showRun(active: ActiveRun): Promise<void> {
  if (!root) return;
  await ready;
  root.innerHTML = `<main class="shell wide"><div id="run"></div></main>`;
  const el = document.getElementById('run');
  if (el) await mountRun(el, { active, store, providers, demo: providers === null, onExit: () => showInbox() });
}

async function showReview(stops: Stop[]): Promise<void> {
  if (!root) return;
  root.innerHTML = `<main class="shell wide"><p>${t('review.resolving')}</p></main>`;
  await ready;
  const { resolved, demo } = await resolveAll(stops, providers, undefined, (n, total) => {
    const line = root.querySelector('p');
    if (line) line.textContent = `${t('review.resolving')} ${n}/${total}`;
  });
  root.innerHTML = `<main class="shell wide"><div id="review"></div></main>`;
  const el = document.getElementById('review');
  if (el) {
    await mountReview(el, {
      resolved, depot: DEMO_START, demo, providers, onBack: () => showInbox(),
      onStart: (run, matrix, flags, estimated) => {
        const active = startRun(run, matrix, flags, Date.now(), estimated);
        void saveRun(store, active).then(() => showRun(active));
      },
    });
  }
}

const prefill = sharedText();
void ready.then(() => showInbox(prefill));
