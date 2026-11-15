import './styles.css';
import { detectLocale, setLocale, t } from './i18n';
import { resolveAll } from './app/resolveAll';
import { mountInbox } from './inbox/inboxView';
import { DEMO_START } from './providers/demo';
import { idbStore } from './providers/idbStore';
import { mountReview } from './review/reviewView';
import { counts, startRun, type ActiveRun } from './run/model';
import { loadRun, saveRun } from './run/runStore';
import { mountRun } from './run/runView';
import type { Stop } from './domain/types';

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

function showInbox(prefill = ''): void {
  if (!root) return;
  root.innerHTML = `
    <main class="shell">
      <h1>${t('app.name')}</h1>
      <p class="tagline">${t('app.tagline')}</p>
      <div id="inbox"></div>
      <footer>${t('credits.map')}</footer>
    </main>`;
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

// Real providers arrive with the Cloudflare Worker (Phase 6). Until then: clearly-labelled demo positions.
const providers = null;

async function showRun(active: ActiveRun): Promise<void> {
  if (!root) return;
  root.innerHTML = `<main class="shell wide"><div id="run"></div></main>`;
  const el = document.getElementById('run');
  if (el) await mountRun(el, { active, store, providers, demo: providers === null, onExit: () => showInbox() });
}

async function showReview(stops: Stop[]): Promise<void> {
  if (!root) return;
  root.innerHTML = `<main class="shell wide"><p>${t('review.resolving')}</p></main>`;
  const { resolved, demo } = await resolveAll(stops, providers);
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

showInbox(sharedText());
