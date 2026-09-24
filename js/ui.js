// Shared UI helpers: htm binding, icons, sheets, toasts and small widgets.
import { h } from '../vendor/preact/preact.module.js';
import { useEffect, useState } from '../vendor/preact/hooks.module.js';
import htm from '../vendor/htm/htm.module.js';

export const html = htm.bind(h);

// ---- formatting ----
export const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

// ---- icons (24x24 stroke icons) ----
const ICONS = {
  back: 'M15 18l-6-6 6-6',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  first: 'M17 18l-6-6 6-6M7 6v12',
  last: 'M7 18l6-6-6-6M17 6v12',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  close: 'M18 6L6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  check: 'M20 6L9 17l-5-5',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  play: 'M5 3l14 9-14 9V3z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z',
  alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  stop: 'M6 6h12v12H6z',
  flip: 'M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4',
  chart: 'M18 20V10M12 20V4M6 20v-6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z',
  bolt: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  plus: 'M12 5v14M5 12h14',
  pin: 'M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3-1-7z',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM20 17v4H6.5A2.5 2.5 0 0 1 4 19.5',
  home: 'M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  path: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  skip: 'M5 4l10 8-10 8V4zM19 5v14',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  cpu: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM9 9h6v6H9z',
};

export function Icon({ name, size = 20, class: cls = '' }) {
  return html`<svg class=${`icon ${cls}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name] || ''} /></svg>`;
}

export function IconButton({ icon, label, onClick, disabled, class: cls = '', spin }) {
  return html`<button type="button" class=${`icon-btn ${cls}`} onClick=${onClick} disabled=${disabled} aria-label=${label} title=${label}>
    <${Icon} name=${icon} class=${spin ? 'spin' : ''} />
  </button>`;
}

// ---- results bar (from the opponent's point of view) ----
export function ResultBar({ win, draw, loss, compact }) {
  const total = win + draw + loss || 1;
  const w = (win / total) * 100;
  const d = (draw / total) * 100;
  const l = 100 - w - d;
  const label = (x) => (x >= 18 && !compact ? `${Math.round(x)}%` : '');
  return html`<div class=${`wdl ${compact ? 'compact' : ''}`} role="img" aria-label=${`Wins ${Math.round(w)}%, draws ${Math.round(d)}%, losses ${Math.round(l)}%`}>
    <span class="w" style=${{ width: `${w}%` }}>${label(w)}</span>
    <span class="d" style=${{ width: `${d}%` }}>${label(d)}</span>
    <span class="l" style=${{ width: `${l}%` }}>${label(l)}</span>
  </div>`;
}

/** Colour class for the opponent's score: good for us when they score low. */
export function scoreClass(score, n, minGames) {
  if (n < minGames) return 'muted';
  if (score < 0.42) return 'good';
  if (score > 0.58) return 'bad';
  return 'neutral';
}

// ---- toasts ----
const listeners = new Set();
export function toast(message, kind = 'info', ms = 3200) {
  const t = { id: Math.random(), message, kind };
  listeners.forEach((fn) => fn(t, ms));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t, ms) => {
      setItems((a) => [...a, t]);
      setTimeout(() => setItems((a) => a.filter((x) => x.id !== t.id)), ms);
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return html`<div class="toasts" role="status" aria-live="polite">
    ${items.map((t) => html`<div key=${t.id} class=${`toast ${t.kind}`}>${t.message}</div>`)}
  </div>`;
}

// ---- bottom sheet ----
export function Sheet({ open, title, onClose, children, class: cls = '' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`sheet ${cls}`} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-grip" />
      <div class="sheet-head">
        <h2>${title}</h2>
        <${IconButton} icon="close" label="Close" onClick=${onClose} />
      </div>
      <div class="sheet-body">${children}</div>
    </div>
  </div>`;
}

// ---- form bits ----
export function Chips({ options, value, onChange, multi }) {
  const isOn = (v) => (multi ? value.includes(v) : value === v);
  const toggle = (v) => {
    if (!multi) return onChange(v);
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  return html`<div class="chips" role=${multi ? 'group' : 'radiogroup'}>
    ${options.map(
      (o) => html`<button type="button" key=${String(o.value)} class=${`chip ${isOn(o.value) ? 'on' : ''}`} aria-pressed=${isOn(o.value)}
        onClick=${() => toggle(o.value)}>${o.label}${o.count != null ? html`<small>${o.count}</small>` : ''}</button>`
    )}
  </div>`;
}

export function Segmented({ options, value, onChange, class: cls = '' }) {
  return html`<div class=${`segmented ${cls}`} role="tablist">
    ${options.map(
      (o) => html`<button type="button" key=${o.value} role="tab" aria-selected=${value === o.value} class=${value === o.value ? 'on' : ''}
        onClick=${() => onChange(o.value)}>${o.icon ? html`<${Icon} name=${o.icon} size=${16} />` : ''}${o.label}</button>`
    )}
  </div>`;
}

export function Toggle({ label, hint, checked, onChange }) {
  return html`<label class="toggle-row">
    <span><span class="toggle-label">${label}</span>${hint ? html`<small>${hint}</small>` : ''}</span>
    <input type="checkbox" class="switch" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
  </label>`;
}

export function Empty({ icon = 'compass', title, children }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${28} /></div>
    <h3>${title}</h3>
    ${children}
  </div>`;
}

export async function shareOrCopy({ title, text, url }) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url || text);
    toast('Copied to clipboard', 'ok');
  } catch {
    toast('Could not copy', 'error');
  }
}

export function downloadText(filename, text, type = 'application/x-chess-pgn') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
