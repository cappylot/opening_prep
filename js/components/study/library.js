// Home, Library, the "All openings" catalog and the study detail screen
// (ports of HomeView, LibraryView, CatalogBrowserScreen and StudyDetailScreen).
import { useState, useMemo, useEffect } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Chips, Empty, toast, plural, shareOrCopy, downloadText, Sheet } from '../../ui.js';
import { go, studyHash, viewerHash, editorHash } from '../../route.js';
import {
  isCurated,
  chaptersOf,
  cardsOf,
  cardsOfChapter,
  studyBySlug,
  deleteStudy,
  resetProgress,
  markStudy,
  addChapter,
  exportStudyPgn,
  setApp,
} from '../../study/studyStore.js';
import { dueCount, learnedFraction, studySubtitle } from '../../study/metrics.js';
import { startDrill, setReading } from '../../study/session.js';
import { useLibrary, Cover, ProgressBar, Ring, ScreenHeader, Menu, SidePip } from './common.js';
import { drillOptions } from './common.js';
import { DetailsSheet } from './editor.js';

export function metricsOf(study, now = Date.now()) {
  const cards = cardsOf(study.id);
  return { cards: cards.length, due: dueCount(cards, now), learned: learnedFraction(cards) };
}

const open = (s) => go(studyHash(s.slug));

function StudyCard({ study, hero = false }) {
  const m = metricsOf(study);
  return html`<button class=${`study-card ${hero ? 'hero' : ''}`} onClick=${() => open(study)}>
    <${Cover} seed=${study.coverSeed} side=${study.side} due=${m.due} />
    <span class="sc-title">${study.title}</span>
    <small class="sc-sub">${studySubtitle(study)}</small>
    <${ProgressBar} value=${m.learned} />
  </button>`;
}

function Section({ title, onMore, children }) {
  return html`<section class="shelf-section">
    <div class="section-head">
      <h2>${title}</h2>
      ${onMore ? html`<button class="link" onClick=${onMore}>See all</button>` : ''}
    </div>
    ${children}
  </section>`;
}

const sortedByTitle = (a) => a.slice().sort((x, y) => x.title.localeCompare(y.title));
const pinnedFirst = (a) => a.slice().sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0) || (y.created || 0) - (x.created || 0));

export function HomeView({ openSettings }) {
  const lib = useLibrary();
  const studies = [...lib.studies.values()].filter((s) => !s.archived);
  const curated = sortedByTitle(studies.filter(isCurated));
  const mine = pinnedFirst(studies.filter((s) => !isCurated(s)));
  const recent = studies.filter((s) => s.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened)[0];
  const rm = recent && metricsOf(recent);

  return html`<main class="tab-view home">
    <header class="tab-head">
      <h1>Home</h1>
      <${IconButton} icon="user" label="Settings" onClick=${openSettings} />
    </header>
    ${!lib.ready
      ? html`<div class="skeleton" style="height:220px" />`
      : html`
          ${curated.length
            ? html`<${Section} title="Curated openings" onMore=${() => go('#/library/all')}>
                <div class="shelf">${curated.map((s) => html`<${StudyCard} key=${s.id} study=${s} hero />`)}</div>
              </${Section}>`
            : ''}
          ${recent
            ? html`<${Section} title="Keep going">
                <button class="card keep-going" onClick=${() => open(recent)}>
                  <${Cover} seed=${recent.coverSeed} side=${recent.side} size=${64} />
                  <span class="kg-main">
                    <b>${recent.title}</b>
                    <small>${studySubtitle(recent)}${rm.due ? ` · ${rm.due} due` : ''}</small>
                    <${ProgressBar} value=${rm.learned} />
                  </span>
                  <${Ring} value=${rm.learned} size=${46} class="accent" />
                </button>
              </${Section}>`
            : ''}
          <${Section} title="Your openings" onMore=${mine.length ? () => go('#/library/all') : null}>
            ${mine.length
              ? html`<div class="shelf">${mine.map((s) => html`<${StudyCard} key=${s.id} study=${s} />`)}</div>`
              : html`<div class="card empty-card">
                  <p>Build your own repertoire: paste a PGN, play the moves on the board, or start from your Lichess games.</p>
                  <button class="btn primary" onClick=${() => go('#/create')}><${Icon} name="plus" size=${18} /> Start a study</button>
                </div>`}
          </${Section}>
        `}
  </main>`;
}

const SORTS = [
  { value: 'date', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'due', label: 'Due first' },
  { value: 'learned', label: 'Least learned' },
];

export function LibraryView() {
  const lib = useLibrary();
  const [filter, setFilter] = useState('all');
  const [archived, setArchived] = useState(false);
  const sort = lib.app.librarySort || 'date';
  const studies = [...lib.studies.values()].filter((s) => !!s.archived === archived && (filter === 'all' || s.side === filter));
  const metrics = new Map(studies.map((s) => [s.id, metricsOf(s)]));
  const sorted = studies.slice().sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'due') return metrics.get(b.id).due - metrics.get(a.id).due || a.title.localeCompare(b.title);
    if (sort === 'learned') return metrics.get(a.id).learned - metrics.get(b.id).learned || a.title.localeCompare(b.title);
    return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.created || 0) - (a.created || 0);
  });
  const hasArchived = [...lib.studies.values()].some((s) => s.archived);

  return html`<main class="tab-view library">
    <header class="tab-head">
      <h1>${archived ? 'Archived' : 'Library'}</h1>
      <div class="row">
        <label class="sort-select">
          <span class="sr-only">Sort</span>
          <select class="input compact" value=${sort} onChange=${(e) => setApp({ librarySort: e.currentTarget.value })} aria-label="Sort">
            ${SORTS.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
          </select>
        </label>
        <${IconButton} icon="plus" label="New study" class="accent" onClick=${() => go('#/create')} />
      </div>
    </header>
    <div class="library-bar">
      <${Chips} options=${[
        { value: 'all', label: 'All' },
        { value: 'white', label: 'White openings' },
        { value: 'black', label: 'Black openings' },
      ]} value=${filter} onChange=${setFilter} />
    </div>
    ${sorted.length
      ? html`<div class="study-grid">
          ${sorted.map(
            (s) => html`<div class="grid-cell" key=${s.id}>
              <${StudyCard} study=${s} />
              <div class="cell-menu"><${StudyMenu} study=${s} /></div>
            </div>`
          )}
        </div>`
      : html`<${Empty} icon="book" title=${archived ? 'Nothing archived' : 'No openings here yet'}>
          ${archived ? '' : html`<button class="btn primary" onClick=${() => go('#/create')}>Start a study</button>`}
        </${Empty}>`}
    ${hasArchived || archived
      ? html`<p class="center"><button class="link" onClick=${() => setArchived(!archived)}>${archived ? 'Back to the library' : 'Show archived'}</button></p>`
      : ''}
  </main>`;
}

function StudyMenu({ study }) {
  return html`<${Menu} icon="more" label=${`${study.title} options`} items=${[
    { label: study.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onClick: () => markStudy(study.id, { pinned: !study.pinned }) },
    { label: study.archived ? 'Unarchive' : 'Archive', icon: 'archive', onClick: () => markStudy(study.id, { archived: !study.archived }) },
    !isCurated(study) && {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: () => {
        if (confirm(`Delete “${study.title}” and all its progress?`)) deleteStudy(study.id).then(() => toast('Study deleted'));
      },
    },
  ]} />`;
}

export function CatalogView() {
  const lib = useLibrary();
  const studies = [...lib.studies.values()].filter((s) => !s.archived);
  const mine = sortedByTitle(studies.filter((s) => !isCurated(s)));
  const curated = sortedByTitle(studies.filter(isCurated));
  return html`<main class="tab-view catalog">
    <header class="tab-head">
      <div class="row gap"><${IconButton} icon="back" label="Back" onClick=${() => history.back()} /><h1>All openings</h1></div>
    </header>
    ${mine.length ? html`<${Section} title="Your openings"><div class="study-grid">${mine.map((s) => html`<${StudyCard} key=${s.id} study=${s} />`)}</div></${Section}>` : ''}
    <${Section} title="Curated openings"><div class="study-grid">${curated.map((s) => html`<${StudyCard} key=${s.id} study=${s} />`)}</div></${Section}>
  </main>`;
}

// ---------------------------------------------------------------- detail

export function StudyDetail({ slug, settings, onClose }) {
  const lib = useLibrary();
  const study = studyBySlug(slug);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (study) {
      setReading(study.id);
      markStudy(study.id, { lastOpened: Date.now() });
    }
  }, [study?.id]);
  if (!lib.ready) return html`<main class="sheet-view"><div class="center-wrap"><div class="spinner-lg">♞</div></div></main>`;
  if (!study)
    return html`<main class="sheet-view"><${ScreenHeader} title="Not found" onBack=${onClose} backIcon="close" />
      <${Empty} icon="book" title="That study isn't on this device"><button class="btn" onClick=${onClose}>Close</button></${Empty}></main>`;

  const curated = isCurated(study);
  const chapters = chaptersOf(study.id);
  const m = metricsOf(study);
  const drill = (request) => {
    if (!startDrill(request, drillOptions(settings))) toast('Nothing to drill here yet — add some moves first', 'error');
    else go('#/drill');
  };
  const share = async () => {
    const text = exportStudyPgn(study.id);
    const file = `${study.slug}.pgn`;
    try {
      const f = new File([text], file, { type: 'application/x-chess-pgn' });
      if (navigator.canShare?.({ files: [f] })) return await navigator.share({ files: [f], title: study.title });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    downloadText(file, text);
  };
  const newChapter = async () => {
    const id = await addChapter(study.id, `Chapter ${chapters.length + 1}`);
    const ch = lib.chapters.get(id);
    go(editorHash(study.slug, ch.key));
  };

  return html`<main class="sheet-view study-detail">
    <${ScreenHeader} title=${study.title} subtitle=${studySubtitle(study)} onBack=${onClose} backIcon="close" backLabel="Close">
      <${Menu} label="Manage" items=${[
        { label: 'Share PGN', icon: 'share', onClick: share },
        { label: 'Copy PGN', icon: 'copy', onClick: () => shareOrCopy({ title: study.title, text: exportStudyPgn(study.id) }) },
        !curated && { label: 'Edit details', icon: 'edit', onClick: () => setDetails(true) },
        !curated && { label: 'Add chapter', icon: 'plus', onClick: newChapter },
        { label: study.pinned ? 'Unpin' : 'Pin to Home', icon: 'pin', onClick: () => markStudy(study.id, { pinned: !study.pinned }) },
        {
          label: 'Reset progress',
          icon: 'refresh',
          onClick: () => confirm(`Reset all progress on “${study.title}”? The moves stay; the schedule starts over.`) && resetProgress(study.id).then(() => toast('Progress reset')),
        },
        !curated && {
          label: 'Delete opening',
          icon: 'trash',
          danger: true,
          onClick: () => confirm(`Delete “${study.title}” and all its progress?`) && deleteStudy(study.id).then(onClose),
        },
      ]} />
    </${ScreenHeader}>
    <div class="sheet-scroll">
      <div class="detail-head">
        <${Cover} seed=${study.coverSeed} side=${study.side} size=${92} />
        <div>
          <h2>${study.title}</h2>
          <p class="muted"><${SidePip} side=${study.side} /> ${studySubtitle(study)}</p>
          ${study.summary ? html`<p class="summary">${study.summary}</p>` : ''}
        </div>
      </div>
      <div class="stat-tiles">
        <div class="tile"><b>${m.cards}</b><small>Cards</small></div>
        <div class="tile"><b class=${m.due ? 'due' : ''}>${m.due}</b><small>Due now</small></div>
        <div class="tile"><b>${Math.round(m.learned * 100)}%</b><small>Learned</small></div>
      </div>
      <h3 class="list-title">Chapters</h3>
      <ul class="chapter-list">
        ${chapters.map((ch) => {
          const cards = cardsOfChapter(ch.id);
          const due = dueCount(cards, Date.now());
          return html`<li key=${ch.id} class="chapter-row">
            <button class="chapter-main" onClick=${() => go(viewerHash(study.slug, ch.key))}>
              <b>${ch.title}</b>
              <small class="line-moves">${ch.searchLine || 'No moves yet'}</small>
              <${ProgressBar} value=${learnedFraction(cards)} />
            </button>
            ${due ? html`<span class="due-pill">${due}</span>` : ''}
            ${!curated ? html`<${IconButton} icon="edit" label=${`Edit ${ch.title}`} onClick=${() => go(editorHash(study.slug, ch.key))} />` : ''}
          </li>`;
        })}
      </ul>
      ${!curated ? html`<button class="btn block" onClick=${newChapter}><${Icon} name="plus" size=${18} /> Add chapter</button>` : ''}
      ${curated ? html`<p class="hint center">Curated studies are read-only. Share the PGN to make your own copy.</p>` : ''}
    </div>
    <footer class="sheet-foot">
      <button class="btn primary block" disabled=${!m.cards} onClick=${() => drill({ kind: 'study', study: study.id })}>
        <${Icon} name="play" size=${18} /> ${m.due >= 20 ? `Drill ${m.due} due` : 'Drill this study'}
      </button>
    </footer>
    <${DetailsSheet} open=${details} study=${study} onClose=${() => setDetails(false)} />
  </main>`;
}
