// Home screen: find an opponent, choose what to download, reopen recent ones.
import { useEffect, useRef, useState } from '../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Chips, ago, plural, toast, cap } from '../ui.js';
import { autocomplete, PERF_TYPES } from '../lichess.js';
import { listOpponents, deleteOpponent, localFlag } from '../store.js';
import { prepHash, go } from '../route.js';

const MAX_OPTIONS = [200, 500, 1000, 2000].map((v) => ({ value: v, label: String(v) }));
const PERIOD_OPTIONS = [
  { value: 0, label: 'All time' },
  { value: 365 * 2, label: '2 years' },
  { value: 365, label: '1 year' },
  { value: 182, label: '6 months' },
  { value: 91, label: '3 months' },
];

export function SearchView({ settings, updateSettings, openSettings }) {
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState(null);
  const [showOptions, setShowOptions] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    listOpponents().then(setRecent);
  }, []);

  useEffect(() => {
    const term = name.trim();
    if (term.length < 3) return setSuggestions([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      autocomplete(term, ctrl.signal)
        .then(setSuggestions)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [name]);

  const open = (n) => {
    n = n.trim();
    if (!/^[\w-]{2,30}$/.test(n)) {
      toast('Enter a valid Lichess username', 'error');
      return;
    }
    if (!settings.perfTypes.length) {
      toast('Pick at least one time control', 'error');
      setShowOptions(true);
      return;
    }
    go(prepHash(n));
  };

  const remove = async (o) => {
    await deleteOpponent(o.id);
    setRecent((r) => r.filter((x) => x.id !== o.id));
    toast(`Removed ${o.name}`);
  };

  const optionsSummary = `${settings.maxGames} games · ${settings.perfTypes.map(cap).join(', ') || 'no time control'} · ${
    PERIOD_OPTIONS.find((p) => p.value === settings.period)?.label || 'All time'
  }`;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const [installTip, setInstallTip] = useState(isIos && !standalone && !localFlag('install-tip'));

  return html`<main class="search-view">
    <div class="search-top">
      <div class="brand">
        <div class="logo" aria-hidden="true">♞</div>
        <div>
          <h1>Opening Prep</h1>
          <p>Scout a Lichess opponent's openings before you play them.</p>
        </div>
      </div>
      <${IconButton} icon="settings" label="Settings" onClick=${openSettings} />
    </div>

    <form class="search-box" onSubmit=${(e) => (e.preventDefault(), open(name))} autocomplete="off">
      <div class="search-input">
        <${Icon} name="search" />
        <input ref=${inputRef} type="search" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck=${false}
          placeholder="Opponent's Lichess username" value=${name} aria-label="Lichess username"
          onInput=${(e) => setName(e.currentTarget.value)} onFocus=${() => setFocused(true)}
          onBlur=${() => setTimeout(() => setFocused(false), 150)} />
      </div>
      <button class="btn primary" type="submit" disabled=${!name.trim()}>Analyze</button>
      ${focused && suggestions.length
        ? html`<ul class="suggest" role="listbox">
            ${suggestions.slice(0, 8).map(
              (s) => html`<li key=${s.id}>
                <button type="button" onMouseDown=${(e) => e.preventDefault()} onClick=${() => (setName(s.name), open(s.name))}>
                  ${s.online ? html`<span class="dot online" title="Online" />` : html`<span class="dot" />`}
                  ${s.title ? html`<span class="title-badge">${s.title}</span>` : ''}${s.name}
                </button>
              </li>`
            )}
          </ul>`
        : ''}
    </form>

    <section class="card options">
      <button type="button" class="options-toggle" onClick=${() => setShowOptions(!showOptions)} aria-expanded=${showOptions}>
        <span><b>Download</b> ${optionsSummary}</span>
        <${Icon} name=${showOptions ? 'prev' : 'next'} class=${showOptions ? 'rot-90' : ''} />
      </button>
      ${showOptions
        ? html`<div class="options-body">
            <label class="field-label">Time controls</label>
            <${Chips} multi options=${PERF_TYPES.map((p) => ({ value: p, label: cap(p) }))} value=${settings.perfTypes}
              onChange=${(v) => updateSettings({ perfTypes: v })} />
            <label class="field-label">Most recent games</label>
            <${Chips} options=${MAX_OPTIONS} value=${settings.maxGames} onChange=${(v) => updateSettings({ maxGames: v })} />
            <label class="field-label">Period</label>
            <${Chips} options=${PERIOD_OPTIONS} value=${settings.period} onChange=${(v) => updateSettings({ period: v })} />
            <p class="hint">Lichess sends about ${settings.token ? 30 : 20} games per second, so ${settings.maxGames} games take roughly
              ${Math.ceil(settings.maxGames / (settings.token ? 30 : 20))} s. You can stop early and analyze what's loaded.</p>
          </div>`
        : ''}
    </section>

    ${installTip
      ? html`<div class="card tip">
          <${Icon} name="download" />
          <p>Install it: tap <b>Share</b> then <b>Add to Home Screen</b>. It opens like an app and works offline with cached opponents.</p>
          <${IconButton} icon="close" label="Dismiss" onClick=${() => (localFlag('install-tip', '1'), setInstallTip(false))} />
        </div>`
      : ''}

    <section class="recent">
      <h2>Recent opponents</h2>
      ${recent === null
        ? html`<div class="skeleton-list"><div class="skeleton" /><div class="skeleton" /></div>`
        : recent.length === 0
        ? html`<p class="muted">Nobody yet. Search a username above, for example your next tournament opponent.</p>`
        : html`<ul class="recent-list">
            ${recent.map(
              (o) => html`<li key=${o.id} class="recent-item">
                <a href=${prepHash(o.name)} class="recent-main">
                  <span class="avatar">${o.name[0].toUpperCase()}</span>
                  <span class="recent-text">
                    <b>${o.profile?.title ? html`<span class="title-badge">${o.profile.title}</span>` : ''}${o.name}</b>
                    <small>${plural(o.count, 'game')} · updated ${ago(o.fetchedAt)}${o.partial ? ' · partial' : ''}</small>
                  </span>
                </a>
                <${IconButton} icon="trash" label=${`Remove ${o.name}`} onClick=${() => remove(o)} />
              </li>`
            )}
          </ul>`}
    </section>

    <footer class="foot">
      Game data from <a href="https://lichess.org" target="_blank" rel="noopener">lichess.org</a>. Not affiliated with Lichess.
      Everything is stored only on this device.
    </footer>
  </main>`;
}
