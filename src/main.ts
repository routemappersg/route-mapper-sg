import './styles.css';
import { detectLocale, setLocale, t } from './i18n';

setLocale(detectLocale(navigator.language));

const root = document.getElementById('app');
if (root) {
  root.innerHTML = `
    <main class="shell">
      <h1>${t('app.name')}</h1>
      <p class="tagline">${t('app.tagline')}</p>
      <p>${t('app.status')}</p>
      <footer>${t('credits.map')}</footer>
    </main>`;
}
