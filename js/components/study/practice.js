// Practice (port of PracticeView) and Search (port of SearchView) tabs.
import { useState, useMemo } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Segmented, Empty, toast } from '../../ui.js';
import { go, studyHash, viewerHash } from '../../route.js';
import { liveCards, counters, srsOf, setApp, chaptersOf, cardsOf, toggleBookmark } from '../../study/studyStore.js';
import { accuracySeries, needsWork, searchStudies, pushRecent, studySubtitle, dueCount } from '../../study/metrics.js';
import { startDrill } from '../../study/session.js';
import { useLibrary, Cover, SidePip } from './common.js';
import { drillOptions } from './common.js';

function AccuracyChart({ series }) {
  const W = 320;
  const H = 120;
  const pad = { l: 30, r: 8, t: 10, b: 20 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = series.length;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + (1 - v) * ih;
  const pts = series.map((d, i) => (d.rate == null ? null : [x(i), y(d.rate), d]));
  const segs = [];
  let cur = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) (segs.push(cur), (cur = []));
  }
  if (cur.length) segs.push(cur);
  const fmt = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const last = pts.filter(Boolean).at(-1);
  return html`<svg class="acc-chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Daily accuracy">
    ${[0, 0.5, 1].map((v) => html`<g><line x1=${pad.l} x2=${W - pad.r} y1=${y(v)} y2=${y(v)} class="grid" />
      <text x=${pad.l - 6} y=${y(v)} class="axis" text-anchor="end" dominant-baseline="central">${v * 100}%</text></g>`)}
    <text x=${pad.l} y=${H - 4} class="axis">${fmt(series[0].day)}</text>
    <text x=${W - pad.r} y=${H - 4} class="axis" text-anchor="end">Today</text>
    ${segs.map((sg) => html`<polyline points=${sg.map((p) => `${p[0]},${p[1]}`).join(' ')} class="line" />`)}
    ${pts.filter(Boolean).map((p) => html`<circle cx=${p[0]} cy=${p[1]} r=${n > 40 ? 1.8 : 3} class="dot"><title>${fmt(p[2].day)}: ${Math.round(p[2].rate * 100)}% of ${p[2].total}</title></circle>`)}
    ${last ? html`<text x=${Math.min(last[0], W - pad.r - 2)} y=${last[1] - 8} class="value" text-anchor="end">${Math.round(last[2].rate * 100)}%</text>` : ''}
  </svg>`;
}

function Reveal({ san }) {
  const [shown, setShown] = useState(false);
  return html`<button class=${`reveal ${shown ? 'on' : ''}`} onClick=${(e) => (e.stopPropagation(), setShown(!shown))} aria-label=${shown ? san : 'Show the answer'}>
    ${shown ? san : 'Show'}
  </button>`;
}

export function PracticeView({ settings }) {
  const lib = useLibrary();
  const [range, setRange] = useState(30);
  const now = Date.now();
  const c = counters(now);
  const cards = liveCards();
  const series = useMemo(() => accuracySeries(lib.reviews, { now, days: range, rolloverHour: srsOf().rolloverHour }), [lib.version, range]);
  const weak = needsWork(cards, 5);
  const bookmarks = [...lib.bookmarks.values()].filter((b) => lib.cards.has(b.card)).sort((a, b) => b.t - a.t);
  const studies = [...lib.studies.values()].filter((s) => !s.archived).sort((a, b) => a.title.localeCompare(b.title));

  const drill = (request) => {
    if (!startDrill(request, drillOptions(settings))) toast('Nothing to drill', 'error');
    else go('#/drill');
  };
  const cardLabel = (card) => {
    const s = lib.studies.get(card.study);
    return html`<b>${s?.title || 'Study'}</b><small>Move ${Math.floor(card.depth / 2) + 1}${card.srs.lapses ? ` · ${card.srs.lapses} lapse${card.srs.lapses === 1 ? '' : 's'}` : ''}</small>`;
  };

  return html`<main class="tab-view practice">
    <header class="tab-head"><h1>Practice</h1></header>
    <div class="stat-tiles">
      <div class="tile"><b>${c.streak}</b><small>Day streak</small></div>
      <div class="tile"><b>${c.newToday + c.reviewsToday}</b><small>Answered today</small></div>
      <div class="tile"><b>${cards.length}</b><small>Total cards</small></div>
    </div>

    <section class="card">
      <div class="row between"><h3>Accuracy</h3>
        <${Segmented} class="mini" value=${range} onChange=${setRange} options=${[7, 30, 90].map((d) => ({ value: d, label: `${d}d` }))} />
      </div>
      ${lib.reviews.length >= 3
        ? html`<${AccuracyChart} series=${series} /><p class="hint">Share of answers that weren't "again", per study day.</p>`
        : html`<p class="hint">Your accuracy shows up here after a few drills.</p>`}
    </section>

    <section class="card">
      <div class="row between"><h3>Needs work</h3>
        ${weak.length ? html`<button class="btn small primary" onClick=${() => drill({ kind: 'cards', ids: weak.map((w) => w.id) })}>Drill these</button>` : ''}
      </div>
      ${weak.length
        ? html`<ul class="plain-list">${weak.map(
            (w) => html`<li key=${w.id} class="list-row"><span class="list-main">${cardLabel(w)}</span><${Reveal} san=${w.expectedSan[0]} /></li>`
          )}</ul>`
        : html`<p class="hint">Positions you keep missing collect here.</p>`}
    </section>

    <section class="card">
      <div class="row between"><h3>Bookmarked</h3>
        ${bookmarks.length ? html`<button class="btn small" onClick=${() => drill({ kind: 'cards', ids: bookmarks.map((b) => b.card) })}>Drill these</button>` : ''}
      </div>
      ${bookmarks.length
        ? html`<ul class="plain-list">${bookmarks.map((b) => {
            const card = lib.cards.get(b.card);
            return html`<li key=${b.card} class="list-row"><span class="list-main">${cardLabel(card)}</span><${Reveal} san=${card.expectedSan[0]} />
              <${IconButton} icon="close" label="Remove bookmark" onClick=${() => toggleBookmark(b.card)} /></li>`;
          })}</ul>`
        : html`<p class="hint">Tap the bookmark during a drill to keep a position here.</p>`}
    </section>

    <section>
      <h3 class="list-title">Your repertoires</h3>
      ${studies.length
        ? html`<ul class="plain-list">${studies.map((s) => {
            const due = dueCount(cardsOf(s.id), now);
            return html`<li key=${s.id} class="list-row card">
              <button class="list-main row gap" onClick=${() => go(studyHash(s.slug))}>
                <${Cover} seed=${s.coverSeed} side=${s.side} size=${40} />
                <span><b>${s.title}</b><small>${studySubtitle(s)}${due ? ` · ${due} due` : ''}</small></span>
              </button>
              <button class="btn small primary" onClick=${() => drill({ kind: 'study', study: s.id })}>Drill</button>
            </li>`;
          })}</ul>`
        : html`<${Empty} title="No repertoires yet" />`}
    </section>
  </main>`;
}

export function StudySearchView() {
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const recents = lib.app.recents || [];
  const results = useMemo(() => searchStudies(q, [...lib.studies.values()], [...lib.chapters.values()]), [q, lib.version]);
  const remember = () => q.trim().length >= 2 && setApp({ recents: pushRecent(recents, q) });
  const openStudy = (s) => (remember(), go(studyHash(s.slug)));
  const openChapter = (s, ch) => (remember(), go(viewerHash(s.slug, ch.key)));
  const all = [...lib.studies.values()].sort((a, b) => a.title.localeCompare(b.title));

  return html`<main class="tab-view search-tab">
    <header class="tab-head"><h1>Search</h1></header>
    <div class="search-input">
      <${Icon} name="search" />
      <input type="search" placeholder="Openings, ECO codes or moves like e4 c6" value=${q} autocapitalize="off" autocorrect="off" spellcheck=${false}
        onInput=${(e) => setQ(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && remember()} aria-label="Search studies" />
      ${q ? html`<${IconButton} icon="close" label="Clear" onClick=${() => setQ('')} />` : ''}
    </div>
    ${q.trim()
      ? html`
          ${results.studies.length || results.chapters.length
            ? html`
                ${results.studies.length ? html`<h3 class="list-title">Openings</h3>
                  <ul class="plain-list">${results.studies.map((s) => html`<li key=${s.id}><button class="list-row card list-main row gap" onClick=${() => openStudy(s)}>
                    <${Cover} seed=${s.coverSeed} side=${s.side} size=${40} /><span><b>${s.title}</b><small>${studySubtitle(s)}</small></span></button></li>`)}</ul>` : ''}
                ${results.chapters.length ? html`<h3 class="list-title">Lines</h3>
                  <ul class="plain-list">${results.chapters.map(({ chapter, study }) => html`<li key=${chapter.id}><button class="list-row card list-main" onClick=${() => openChapter(study, chapter)}>
                    <span><b>${chapter.title}</b><small>${study.title} · <span class="line-moves">${chapter.searchLine}</span></small></span></button></li>`)}</ul>` : ''}`
            : html`<${Empty} icon="search" title="No matches"><p>Try an opening name, an ECO code like B12, or moves like “e4 c6 d4”.</p></${Empty}>`}`
      : html`
          ${recents.length
            ? html`<div class="row between"><h3 class="list-title">Recent</h3><button class="link" onClick=${() => setApp({ recents: [] })}>Clear</button></div>
                <div class="chips">${recents.map((r) => html`<button class="chip" onClick=${() => setQ(r)}>${r}</button>`)}</div>`
            : ''}
          <h3 class="list-title">Browse</h3>
          <ul class="plain-list">${all.map((s) => html`<li key=${s.id}><button class="list-row card list-main row gap" onClick=${() => go(studyHash(s.slug))}>
            <${Cover} seed=${s.coverSeed} side=${s.side} size=${40} /><span><b>${s.title}</b><small>${studySubtitle(s)} · ${chaptersOf(s.id).length} chapters</small></span></button></li>`)}</ul>`}
  </main>`;
}

export { SidePip };
