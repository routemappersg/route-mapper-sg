import './styles.css';
import { detectLocale, setLocale, t } from './i18n';
import { mountInbox } from './inbox/inboxView';
import { idbStore } from './providers/idbStore';

setLocale(detectLocale(navigator.language));

/** Text shared into the app (Android "Share" -> Route Mapper) arrives as ?text=... and is shown, not sent anywhere. */
function sharedText(): string {
  const p = new URLSearchParams(location.search);
  const text = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n');
  if (text) history.replaceState(null, '', location.pathname);
  return text;
}

const root = document.getElementById('app');
if (root) {
  root.innerHTML = `
    <main class="shell">
      <h1>${t('app.name')}</h1>
      <p class="tagline">${t('app.tagline')}</p>
      <div id="inbox"></div>
      <footer>${t('credits.map')}</footer>
    </main>`;
  const inbox = document.getElementById('inbox');
  if (inbox) void mountInbox(inbox, idbStore(), sharedText());
}
