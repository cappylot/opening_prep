// The tab bar and the mini-player above it (ports of AnimatedTabView and
// SessionAccessoryModifier / MiniPlayerAccessory).
import { html, Icon } from '../../ui.js';
import { go, tabHash, studyHash } from '../../route.js';
import { useActiveSession, useLibrary, Cover } from './common.js';
import { dueToday, isCurated } from '../../study/studyStore.js';
import { dueCount } from '../../study/metrics.js';
import { cardsOf } from '../../study/studyStore.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'practice', label: 'Practice', icon: 'path' },
  { id: 'library', label: 'Library', icon: 'book' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'opponents', label: 'Opponents', icon: 'users' },
];

export function TabBar({ tab }) {
  const lib = useLibrary();
  const due = lib.ready ? dueToday() : 0;
  return html`<nav class="tabbar" aria-label="Sections">
    ${TABS.map(
      (t) => html`<a key=${t.id} href=${tabHash(t.id)} class=${`tab ${tab === t.id ? 'on' : ''}`} aria-current=${tab === t.id ? 'page' : undefined}>
        <span class="tab-ico"><${Icon} name=${t.icon} size=${22} />${t.id === 'practice' && due ? html`<span class="tab-badge">${due > 99 ? '99+' : due}</span>` : ''}</span>
        <span class="tab-label">${t.label}</span>
      </a>`
    )}
  </nav>`;
}

/**
 * Exactly one state, highest priority first: now drilling, drill finished,
 * now reading, preparing, idle.
 */
export function accessoryState(active, studies) {
  const s = active.session;
  if (s && !s.finished) return { kind: 'drilling', session: s };
  if (active.summary) return { kind: 'finished', summary: active.summary };
  if (active.reading && studies.has(active.reading)) return { kind: 'reading', study: studies.get(active.reading) };
  if (active.preparing) return { kind: 'preparing' };
  const recent = [...studies.values()].filter((x) => x.lastOpened && !x.archived).sort((a, b) => b.lastOpened - a.lastOpened)[0];
  return { kind: 'idle', study: recent || null };
}

export function MiniPlayer() {
  const active = useActiveSession();
  const lib = useLibrary();
  const st = accessoryState(active, lib.studies);
  let body;
  let onClick;
  if (st.kind === 'drilling') {
    const s = st.session;
    const line = s.line;
    onClick = () => go('#/drill');
    body = html`<${Cover} seed=${line?.coverSeed || 0} size=${36} />
      <span class="mp-text"><b>${line?.studyTitle || 'Drill'}</b>
        <small>Line ${Math.min(s.lineIndex + 1, s.lineCount)}/${s.lineCount} · ${Math.round(s.accuracy * 100)}%</small></span>
      <span class="mp-live" aria-label="Drill in progress" />`;
  } else if (st.kind === 'finished') {
    const m = st.summary;
    onClick = () => go('#/drill');
    body = html`<${Cover} seed=${m.coverSeed} size=${36} />
      <span class="mp-text"><b>${m.completed ? 'Drill complete' : 'Drill ended'}</b>
        <small>${m.correct} of ${m.total} first try · ${Math.round(m.accuracy * 100)}%</small></span>`;
  } else if (st.kind === 'reading') {
    const due = dueCount(cardsOf(st.study.id), Date.now());
    onClick = () => go(studyHash(st.study.slug));
    body = html`<${Cover} seed=${st.study.coverSeed} side=${st.study.side} size=${36} />
      <span class="mp-text"><b>${st.study.title}</b><small>${due ? `${due} due` : 'Nothing due'}</small></span>`;
  } else if (st.kind === 'preparing') {
    body = html`<span class="spinner-sm" /><span class="mp-text"><b>Choosing lines…</b></span>`;
  } else if (st.study) {
    onClick = () => go(studyHash(st.study.slug));
    body = html`<${Cover} seed=${st.study.coverSeed} side=${st.study.side} size=${36} />
      <span class="mp-text"><b>Pick up where you left off</b><small>${st.study.title}</small></span>`;
  } else {
    onClick = () => go('#/');
    body = html`<span class="mp-ico"><${Icon} name="play" size=${18} /></span><span class="mp-text"><b>Start a study</b>
      <small>${[...lib.studies.values()].filter(isCurated).length} curated openings to begin with</small></span>`;
  }
  return html`<button class="mini-player" onClick=${onClick} disabled=${!onClick}>${body}<${Icon} name="chevron-up" size=${18} /></button>`;
}
