import './styles.css';
import { detectLocale, setLocale, t } from './i18n';
import { flushOutbox } from './app/community';
import { buildProviders, loadServerConfig } from './app/config';
import { idbStore } from './providers/idbStore';
import { mountPlanner } from './planner/plannerView';
import { mountReview } from './review/reviewView';
import { counts, startRun, type ActiveRun } from './run/model';
import { loadRun, saveRun } from './run/runStore';
import { mountRun } from './run/runView';
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

// With VITE_API_BASE set the app uses the Worker; without it, clearly-labelled demo positions.
let providers: Providers | null = null;
let banner: string | null = null;
const ready = loadServerConfig().then((cfg) => {
  providers = cfg ? buildProviders(store, cfg) : null;
  banner = cfg?.banner ?? null;
  if (providers) void flushOutbox(store);
});

async function showPlanner(prefill = ''): Promise<void> {
  if (!root) return;
  await ready;
  root.innerHTML = '<main class="screen" id="screen"></main>';
  const el = document.getElementById('screen');
  if (!el) return;
  await mountPlanner(el, {
    store, providers, banner, prefill,
    onPlan: (plan) => void showReview(plan),
  });
  // A run in progress survives closing the app: offer to pick it up.
  const active = await loadRun(store);
  const slot = el.querySelector('#resume');
  if (active && slot) {
    const c = counts(active);
    slot.innerHTML = `<button id="resume-run" class="primary wide">${escapeHtml(t('run.resume', { n: c.delivered + c.failed, total: active.run.items.length }))}</button>`;
    slot.querySelector('#resume-run')?.addEventListener('click', () => void showRun(active));
  }
}

async function showRun(active: ActiveRun): Promise<void> {
  if (!root) return;
  await ready;
  root.innerHTML = '<main class="screen" id="screen"></main>';
  const el = document.getElementById('screen');
  if (el) await mountRun(el, { active, store, providers, demo: providers === null, onExit: () => void showPlanner(), onBack: () => void showPlanner() });
}

async function showReview(plan: import('./planner/plannerView').PlanRequest): Promise<void> {
  if (!root) return;
  root.innerHTML = '<main class="screen" id="screen"></main>';
  const el = document.getElementById('screen');
  if (!el) return;
  await mountReview(el, {
    resolved: plan.resolved, depot: plan.depot, startKnown: plan.startKnown, demo: plan.demo, providers,
    onBack: () => void showPlanner(),
    onStart: (run, matrix, flags, estimated) => {
      const active = startRun(run, matrix, flags, Date.now(), estimated);
      void saveRun(store, active).then(() => showRun(active));
    },
  });
}

const prefill = sharedText();
void showPlanner(prefill);
