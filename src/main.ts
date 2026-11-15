import './styles.css';
import { detectLocale, setLocale, t } from './i18n';
import { mountInbox } from './inbox/inboxView';

setLocale(detectLocale(navigator.language));

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
  if (inbox) mountInbox(inbox);
}
