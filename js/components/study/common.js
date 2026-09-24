// Shared pieces for the study screens: library hooks, covers, the settings-aware
// board and small widgets.
import { useEffect, useMemo, useState } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton } from '../../ui.js';
import { Board } from '../../board.js';
import { subscribe, lib, initStudies } from '../../study/studyStore.js';
import { onSession, activeSession } from '../../study/session.js';
import { sideName } from '../../study/metrics.js';

/** Re-renders on every library write; returns the library snapshot. */
export function useLibrary() {
  const [, setV] = useState(lib().version);
  useEffect(() => {
    initStudies();
    return subscribe(setV);
  }, []);
  // A tick every 30 s so due badges move on while the app sits open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    const vis = () => document.visibilityState === 'visible' && setTick((x) => x + 1);
    document.addEventListener('visibilitychange', vis);
    return () => (clearInterval(t), document.removeEventListener('visibilitychange', vis));
  }, []);
  return lib();
}

export function useActiveSession() {
  const [, setV] = useState(0);
  useEffect(() => onSession(() => setV((x) => x + 1)), []);
  return activeSession();
}

// ---- covers: a seeded 4x4 colour field, after StudyCoverStyle.swift ----
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

export function coverColors(seed) {
  const r = rng(seed + 1);
  const baseHue = (seed * 0.618033988749895) % 1;
  const span = 0.14 + r() * 0.12;
  const dir = r() < 0.5 ? -1 : 1;
  const diag = Math.floor(r() * 4);
  const lf = [0.55 + r() * 0.55, 0.55 + r() * 0.55];
  const lp = [r() * Math.PI * 2, r() * Math.PI * 2];
  const out = [];
  for (let i = 0; i < 16; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = col / 3;
    const y = row / 3;
    const sx = diag & 1 ? -1 : 1;
    const sy = diag & 2 ? -1 : 1;
    const ramp = clamp01(0.5 + (sx * (x - 0.5) + sy * (y - 0.5)) / 2);
    const lobe = Math.sin(col * Math.PI * lf[0] + lp[0]) * Math.cos(row * Math.PI * lf[1] + lp[1]);
    const hue = baseHue + dir * span * (ramp - 0.5) + span * 0.45 * lobe + (r() - 0.5) * 0.03;
    const sat = 0.62 - 0.24 * ramp + 0.14 * lobe + (r() - 0.5) * 0.1;
    let val = 0.4 + 0.4 * ramp + 0.13 * lobe + (r() - 0.5) * 0.08;
    if (i === 3 || i === 12) val = Math.min(val, 0.72);
    out.push(hsv(hue, clamp01(sat), clamp01(val)));
  }
  return out;
}

export function Cover({ seed = 0, side, size, class: cls = '', due = 0 }) {
  const colors = useMemo(() => coverColors(seed), [seed]);
  const id = `cv${seed}`;
  return html`<div class=${`cover ${cls}`} style=${size ? { width: `${size}px`, height: `${size}px` } : null} aria-hidden="true">
    <svg viewBox="0 0 4 4" preserveAspectRatio="none">
      <defs><filter id=${id} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.55" /></filter></defs>
      <rect width="4" height="4" fill=${colors[5]} />
      <g filter=${`url(#${id})`}>${colors.map((c, i) => html`<rect x=${(i % 4) - 0.1} y=${Math.floor(i / 4) - 0.1} width="1.2" height="1.2" fill=${c} />`)}</g>
    </svg>
    ${side ? html`<span class=${`side-pip ${side}`} title=${`${sideName(side)} repertoire`} />` : ''}
    ${due > 0 ? html`<span class="due-badge">${due}</span>` : ''}
  </div>`;
}

export const SidePip = ({ side }) => html`<span class=${`side-pip inline ${side}`} aria-label=${`${sideName(side)}`} />`;

export function ProgressBar({ value, class: cls = '' }) {
  return html`<div class=${`progress thin ${cls}`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(value * 100)}>
    <span style=${{ width: `${Math.round(value * 100)}%` }} />
  </div>`;
}

export function Ring({ value, size = 44, stroke = 5, class: cls = '', label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return html`<svg class=${`ring ${cls}`} width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} role="img" aria-label=${label || `${Math.round(value * 100)}%`}>
    <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--bg-3)" stroke-width=${stroke} />
    <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round"
      stroke-dasharray=${`${c * value} ${c}`} transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
    ${label !== '' ? html`<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${label ?? `${Math.round(value * 100)}%`}</text>` : ''}
  </svg>`;
}

/** A board that honours the appearance settings. */
export function StudyBoard({ settings, ...props }) {
  return html`<${Board} coords=${settings.coords} theme=${settings.board} pieces=${settings.pieces} animation=${settings.animation}
    lastMoveHighlight=${settings.lastMove} decoration=${settings.decoration} askPromotion=${true} ...${props} />`;
}

/** Coach arrows and marks as chessground shapes and highlight classes. */
export function decorations(note, extra = {}) {
  const shapes = (note?.arrows || []).map((a) => ({ orig: a.from, dest: a.to, brush: 'deco' }));
  const highlights = new Map();
  for (const m of note?.marks || []) highlights.set(m.square, 'mark');
  for (const [sq, cls] of Object.entries(extra)) if (sq) highlights.set(sq, cls);
  return { shapes, highlights };
}

/** A header row for sheet screens: back/close, title, actions. */
export function ScreenHeader({ title, subtitle, onBack, backIcon = 'back', backLabel = 'Back', children, cover }) {
  return html`<header class="topbar study-top">
    ${onBack ? html`<${IconButton} icon=${backIcon} label=${backLabel} onClick=${onBack} />` : ''}
    ${cover || ''}
    <div class="opp-card">
      <span class="opp-name">${title}</span>
      ${subtitle ? html`<small>${subtitle}</small>` : ''}
    </div>
    ${children}
  </header>`;
}

/** A small popover menu anchored to a button. */
export function Menu({ icon = 'more', label = 'More', items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => window.addEventListener('click', close, { once: true }), 0);
    return () => (clearTimeout(t), window.removeEventListener('click', close));
  }, [open]);
  return html`<div class="menu-wrap">
    <${IconButton} icon=${icon} label=${label} onClick=${() => setOpen(!open)} />
    ${open &&
    html`<div class="menu" role="menu">
      ${items
        .filter(Boolean)
        .map(
          (it) => html`<button type="button" role="menuitem" class=${`menu-item ${it.danger ? 'danger' : ''}`} disabled=${it.disabled}
            onClick=${() => (setOpen(false), it.onClick())}>${it.icon ? html`<${Icon} name=${it.icon} size=${18} />` : ''}${it.label}</button>`
        )}
    </div>`}
  </div>`;
}

export const moveNumberLabel = (ply, side) => (side === 'white' ? `${Math.floor(ply / 2) + 1}.` : `${Math.floor(ply / 2) + 1}…`);

/** Vertical move list with variation-aware numbering; `moves` are {san, ply, side, id}. */
export function MoveList({ moves, current, onJump, horizontal = false }) {
  return html`<div class=${horizontal ? 'trail' : 'move-list'} role="list">
    ${moves.map(
      (m, i) => html`${m.side === 'white' || i === 0 ? html`<span class="trail-num">${moveNumberLabel(m.ply - 1, m.side)}</span>` : ''}<button
          role="listitem" class=${`trail-move ${m.id === current ? 'cur' : ''}`} onClick=${() => onJump(m.id)}>${m.san}</button>`
    )}
  </div>`;
}

/** Session options from the settings. */
export const drillOptions = (settings) => ({ animation: settings.animation, manualPacing: () => settings.drillPacing === 'manual' });
