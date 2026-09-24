// Creating a study (ports of CreateStudyFlowView, PastePGNScreen and
// LichessImportScreen). Unlike the iOS app, a Lichess suggestion can become a
// real study: its lines are what you actually play in that opening.
import { useState, useMemo, useRef, useEffect } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Segmented, toast, Empty, pct } from '../../ui.js';
import { go, studyHash } from '../../route.js';
import { parsePgn, studyMetaFromChapters } from '../../study/pgn.js';
import { importStudy, draftChapter, hex8, setApp, lib } from '../../study/studyStore.js';
import { createTree, insertChild, mainline, moveCount } from '../../study/movetree.js';
import { streamGames, ApiError } from '../../lichess.js';
import { replayGame } from '../../tree.js';
import { ScreenHeader } from './common.js';
import { Diagnostics } from './editor.js';

export function CreateView({ onClose }) {
  const opt = (icon, title, body, hash) => html`<button class="card create-opt" onClick=${() => go(hash)}>
    <span class="create-ico"><${Icon} name=${icon} size=${24} /></span>
    <span><b>${title}</b><small>${body}</small></span>
    <${Icon} name="next" />
  </button>`;
  return html`<main class="tab-view create">
    <header class="tab-head"><div class="row gap"><${IconButton} icon="back" label="Back" onClick=${onClose} /><h1>New study</h1></div></header>
    ${opt('edit', 'Build it on the board', 'Play your moves and your answers to the opponent’s tries.', '#/create/board')}
    ${opt('copy', 'Paste a PGN', 'From Lichess studies, ChessBase or any file. Variations and arrows come along.', '#/create/pgn')}
    ${opt('bolt', 'From your Lichess games', 'See the openings you actually play, and turn one into a study.', '#/create/lichess')}
  </main>`;
}

export function PastePgnView({ onClose }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [side, setSide] = useState(null);
  const fileRef = useRef(null);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const chapters = parsePgn(text);
      const meta = studyMetaFromChapters(chapters, 'imported-study');
      // No StudyTitle tag: the first game's Event, as the iOS importer does.
      if (!chapters[0]?.tags.StudyTitle) meta.title = chapters[0]?.title !== 'Imported chapter' ? chapters[0].title : 'Imported study';
      return { chapters, meta };
    } catch (e) {
      return { error: e.message, diagnostics: e.diagnostics };
    }
  }, [text]);
  const effSide = side || parsed?.meta?.side || 'white';
  const effTitle = title.trim() || parsed?.meta?.title || '';

  const save = async () => {
    const slug = `import-${hex8()}`;
    const { meta, chapters } = parsed;
    await importStudy({
      slug,
      title: effTitle || 'Imported study',
      summary: meta.summary,
      eco: meta.eco,
      side: effSide,
      source: { kind: 'pgn' },
      chapters: chapters.map((c, i) => draftChapter(c, slug, i)),
    });
    toast('Study imported', 'ok');
    go(studyHash(slug));
  };
  const pickFile = async (e) => {
    const f = e.currentTarget.files?.[0];
    if (f) setText(await f.text());
  };

  return html`<main class="sheet-view paste">
    <${ScreenHeader} title="Paste a PGN" onBack=${onClose} backIcon="close" backLabel="Cancel">
      <button class="btn primary small" disabled=${!parsed || parsed.error} onClick=${save}>Import</button>
    </${ScreenHeader}>
    <div class="sheet-scroll form">
      <textarea class="input mono" rows="9" placeholder=${'[Event "My repertoire"]\n\n1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 *'} value=${text}
        onInput=${(e) => setText(e.currentTarget.value)} aria-label="PGN" />
      <div class="row gap">
        <button class="btn small" onClick=${() => fileRef.current.click()}><${Icon} name="download" size=${16} /> Open a .pgn file</button>
        <input ref=${fileRef} type="file" accept=".pgn,.txt,application/x-chess-pgn" hidden onChange=${pickFile} />
        ${navigator.clipboard?.readText
          ? html`<button class="btn small ghost" onClick=${() => navigator.clipboard.readText().then(setText, () => toast('Clipboard not available', 'error'))}>Paste</button>`
          : ''}
      </div>
      ${parsed?.error ? html`<p class="warn">${parsed.error}</p><${Diagnostics} list=${parsed.diagnostics} />` : ''}
      ${parsed && !parsed.error
        ? html`
            <label class="field-label" for="pt">Title</label>
            <input id="pt" class="input" value=${title} placeholder=${parsed.meta.title} onInput=${(e) => setTitle(e.currentTarget.value)} />
            <label class="field-label">You play</label>
            <${Segmented} value=${effSide} onChange=${setSide} options=${[
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
            ]} />
            ${!side && parsed.chapters[0]?.side ? html`<p class="hint">Guessed from the moves: your side usually has fewer alternatives.</p>` : ''}
            <label class="field-label">Preview</label>
            <p class="hint">${parsed.chapters.length} chapter${parsed.chapters.length === 1 ? '' : 's'} ·
              ${parsed.chapters.reduce((n, c) => n + moveCount(c.tree), 0)} moves</p>
            <ul class="plain-list">
              ${parsed.chapters.map(
                (c, i) => html`<li key=${i} class="list-row card"><span class="list-main"><b>${c.title}</b>
                  <small class="line-moves">${mainline(c.tree).slice(0, 10).map((n) => n.san).join(' ')}</small></span></li>`
              )}
            </ul>
            <${Diagnostics} list=${parsed.chapters.flatMap((c) => c.diagnostics)} />`
        : ''}
    </div>
  </main>`;
}

/** Groups a user's games by opening family, for one colour. */
export function openingGroups(replayed, color) {
  const groups = new Map();
  for (const g of replayed) {
    if (g.oppColor !== color || !g.opening?.name) continue;
    const family = g.opening.name.split(':')[0].trim();
    if (!groups.has(family)) groups.set(family, { name: family, eco: g.opening.eco, games: [], score: 0 });
    const grp = groups.get(family);
    grp.games.push(g);
    grp.score += g.res;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, count: g.games.length, score: g.score / g.games.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/**
 * The lines a player actually plays: their most common move at each of their
 * turns, and the opponent replies that came up at least twice (at most three).
 */
export function repertoireTree(games, color, { maxPly = 20, minGames = 2, maxReplies = 3 } = {}) {
  const trie = { n: 0, kids: new Map() };
  for (const g of games) {
    let cur = trie;
    cur.n += 1;
    for (const [, uci] of g.plies.slice(0, maxPly)) {
      if (!cur.kids.has(uci)) cur.kids.set(uci, { n: 0, kids: new Map() });
      cur = cur.kids.get(uci);
      cur.n += 1;
    }
  }
  const tree = createTree();
  const walk = (t, nodeId, ply) => {
    const mine = (ply % 2 === 0) === (color === 'white');
    let kids = [...t.kids.entries()].filter(([, k]) => k.n >= minGames).sort((a, b) => b[1].n - a[1].n);
    kids = mine ? kids.slice(0, 1) : kids.slice(0, maxReplies);
    for (const [uci, k] of kids) {
      const id = insertChild(tree, nodeId, uci);
      if (id) walk(k, id, ply + 1);
    }
  };
  walk(trie, tree.rootId, 0);
  return tree;
}

export function LichessImportView({ settings, onClose }) {
  const [name, setName] = useState(settings.me || lib().app.lichess || '');
  const [color, setColor] = useState('white');
  const [state, setState] = useState({ status: 'idle' });
  const ctrl = useRef(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const load = async () => {
    const n = name.trim();
    if (!/^[\w-]{2,30}$/.test(n)) return toast('Enter a valid Lichess username', 'error');
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setState({ status: 'loading', count: 0 });
    const games = [];
    try {
      await streamGames(n, {
        max: 200,
        perfTypes: settings.perfTypes,
        signal: ctrl.current.signal,
        onGame: (g) => {
          const r = replayGame(g, n, 24);
          if (r) games.push(r);
          if (games.length % 20 === 0) setState({ status: 'loading', count: games.length });
        },
        onWait: (s) => setState({ status: 'loading', count: games.length, wait: s }),
      });
      setApp({ lichess: n });
      setState({ status: 'ready', games, name: n });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setState({ status: 'error', message: e instanceof ApiError && e.status === 404 ? `No Lichess player called ${n}` : e.message });
    }
  };

  const groups = state.status === 'ready' ? openingGroups(state.games, color) : [];
  const create = async (grp) => {
    const tree = repertoireTree(grp.games, color);
    if (tree.nodes.size < 2) return toast('Not enough repeated moves to build lines from', 'error');
    const slug = `lichess-${hex8()}`;
    await importStudy({
      slug,
      title: grp.name,
      summary: `Built from ${grp.count} of ${state.name}'s games as ${color}: the moves you play most, and the replies you meet at least twice.`,
      eco: grp.eco,
      side: color,
      source: { kind: 'lichess', user: state.name },
      chapters: [{ title: 'From your games', key: `${slug}-ch0`, order: 0, tree, preamble: null }],
    });
    toast('Study created', 'ok');
    go(studyHash(slug));
  };

  return html`<main class="sheet-view lichess-import">
    <${ScreenHeader} title="From your Lichess games" onBack=${onClose} backIcon="close" backLabel="Cancel" />
    <div class="sheet-scroll form">
      <label class="field-label" for="lu">Lichess username</label>
      <div class="row gap">
        <input id="lu" class="input" value=${name} autocapitalize="off" autocorrect="off" spellcheck=${false}
          onInput=${(e) => setName(e.currentTarget.value)} onKeyDown=${(e) => e.key === 'Enter' && load()} />
        <button class="btn primary" onClick=${load} disabled=${state.status === 'loading'}>Look up</button>
      </div>
      <label class="field-label">As</label>
      <${Segmented} value=${color} onChange=${setColor} options=${[
        { value: 'white', label: 'White' },
        { value: 'black', label: 'Black' },
      ]} />
      ${state.status === 'loading' ? html`<p class="hint">${state.wait ? `Lichess asked us to wait ${state.wait}s…` : `Reading games… ${state.count}`}</p>` : ''}
      ${state.status === 'error' ? html`<p class="warn">${state.message}</p>` : ''}
      ${state.status === 'ready'
        ? groups.length
          ? html`<p class="hint">Your ${groups.length} most played openings as ${color} in your last ${state.games.length} games.</p>
              <ul class="plain-list">
                ${groups.map(
                  (g) => html`<li key=${g.name} class="list-row card">
                    <span class="list-main"><b>${g.name}</b><small>${g.eco || ''} · ${g.count} game${g.count === 1 ? '' : 's'} · you score ${pct(g.score)}</small></span>
                    <button class="btn small primary" onClick=${() => create(g)}>Create study</button>
                  </li>`
                )}
              </ul>`
          : html`<${Empty} title=${`No games as ${color}`} />`
        : ''}
    </div>
  </main>`;
}
