// App entry: hash router, theme and service worker.
import { render } from '../vendor/preact/preact.module.js';
import { useEffect, useState } from '../vendor/preact/hooks.module.js';
import { html, Toaster } from './ui.js';
import { getSettings, saveSettings } from './store.js';
import { SearchView } from './components/search.js';
import { PrepView } from './components/prep.js';
import { SettingsSheet } from './components/settings.js';
import { parseHash } from './route.js';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181d' : '#f6f5f2');
}

function App() {
  const [route, setRoute] = useState(parseHash());
  const [settings, setSettings] = useState(getSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme('system');
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, [settings.theme]);

  const ctx = {
    settings,
    updateSettings: (patch) => setSettings(saveSettings(patch)),
    openSettings: () => setSettingsOpen(true),
  };

  return html`
    ${route.view === 'prep' ? html`<${PrepView} key=${route.name.toLowerCase()} route=${route} ...${ctx} />` : html`<${SearchView} ...${ctx} />`}
    <${SettingsSheet} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} ...${ctx} />
    <${Toaster} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
