// App entry: hash router, theme and service worker.
import { render } from '../vendor/preact/preact.module.js';
import { useEffect, useState } from '../vendor/preact/hooks.module.js';
import { html, Toaster } from './ui.js';
import { getSettings, saveSettings } from './store.js';
import { SearchView } from './components/search.js';
import { PrepView } from './components/prep.js';
import { SettingsSheet } from './components/settings.js';
import { parseHash, go, tabHash } from './route.js';
import { initStudies } from './study/studyStore.js';
import { setReading } from './study/session.js';
import { TabBar, MiniPlayer } from './components/study/shell.js';
import { HomeView, LibraryView, CatalogView, StudyDetail } from './components/study/library.js';
import { ViewerView } from './components/study/viewer.js';
import { EditorView } from './components/study/editor.js';
import { DrillView } from './components/study/drill.js';
import { PracticeView, StudySearchView } from './components/study/practice.js';
import { CreateView, PastePgnView, LichessImportView } from './components/study/create.js';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181d' : '#f6f5f2');
}

// The tab a full-screen study view returns to when closed.
let lastTab = 'home';

function App() {
  const [route, setRoute] = useState(parseHash());
  const [settings, setSettings] = useState(getSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    initStudies();
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.tab && !route.sheet) lastTab = route.tab;
    if (!route.sheet || route.view === 'drill') setReading(null);
    window.scrollTo?.(0, 0);
  }, [route.view, route.slug]);

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
  const close = () => go(tabHash(lastTab));

  let view;
  switch (route.view) {
    case 'prep':
      view = html`<${PrepView} key=${route.name.toLowerCase()} route=${route} ...${ctx} />`;
      break;
    case 'opponents':
      view = html`<${SearchView} ...${ctx} />`;
      break;
    case 'practice':
      view = html`<${PracticeView} ...${ctx} />`;
      break;
    case 'library':
      view = html`<${LibraryView} ...${ctx} />`;
      break;
    case 'catalog':
      view = html`<${CatalogView} ...${ctx} />`;
      break;
    case 'search':
      view = html`<${StudySearchView} ...${ctx} />`;
      break;
    case 'study':
      view = html`<${StudyDetail} key=${route.slug} slug=${route.slug} onClose=${close} ...${ctx} />`;
      break;
    case 'viewer':
      view = html`<${ViewerView} key=${`${route.slug}/${route.key}`} slug=${route.slug} chapterKey=${route.key} moves=${route.moves} onClose=${close} ...${ctx} />`;
      break;
    case 'editor':
      view = html`<${EditorView} key=${`${route.slug}/${route.key}`} slug=${route.slug} chapterKey=${route.key} onClose=${() => history.back()} ...${ctx} />`;
      break;
    case 'create':
      view = html`<${CreateView} onClose=${close} ...${ctx} />`;
      break;
    case 'create-board':
      view = html`<${EditorView} key="create" create=${true} onClose=${() => go('#/create')} ...${ctx} />`;
      break;
    case 'create-pgn':
      view = html`<${PastePgnView} onClose=${() => go('#/create')} ...${ctx} />`;
      break;
    case 'create-lichess':
      view = html`<${LichessImportView} onClose=${() => go('#/create')} ...${ctx} />`;
      break;
    case 'drill':
      view = html`<${DrillView} onClose=${close} ...${ctx} />`;
      break;
    default:
      view = html`<${HomeView} ...${ctx} />`;
  }

  // Tabs get the tab bar and the mini-player; the opponent prep screen and the
  // study "sheet" screens are full-screen, like the iOS opening sheet.
  const chrome = !route.sheet && route.view !== 'prep';
  return html`
    <div class=${`app ${chrome ? 'with-tabs' : 'full'}`}>
      ${view}
      ${chrome ? html`<div class="dock"><${MiniPlayer} /><${TabBar} tab=${route.tab} /></div>` : ''}
    </div>
    <${SettingsSheet} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} ...${ctx} />
    <${Toaster} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
