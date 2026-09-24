// The chapter editor and its sheets (ports of StudyEditorScreen / StudyEditorModel,
// ChapterPGNImportSheet, StartPositionSheet and StudyDetailsEditorSheet). Also
// edits what the iOS app models but never exposes: a move's idea, its "why not"
// notes and the always-drill policy.
import { useState, useEffect, useMemo, useRef } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Segmented, Sheet, Toggle, toast, Empty, downloadText } from '../../ui.js';
import { go, studyHash, editorHash, viewerHash } from '../../route.js';
import {
  studyBySlug,
  chaptersOf,
  treeOf,
  updateChapter,
  updateStudy,
  importStudy,
  isCurated,
  deleteChapter,
  reorderChapters,
  lib,
  hex8,
  exportChapterPgn,
} from '../../study/studyStore.js';
import {
  createTree,
  cloneTree,
  insertChild,
  childrenOf,
  pathIds,
  promoteToMainline,
  removeSubtree,
  subtreeCount,
  mergeTree,
  emptyNote,
  noteIsEmpty,
  POLICY,
  mainline,
  movesTo,
  nodeAtPath,
} from '../../study/movetree.js';
import { parsePgn, styleOfLetter, letterOfStyle } from '../../study/pgn.js';
import { load, destsOf, turnOf, START_FEN } from '../../study/chess.js';
import { useLibrary, StudyBoard, decorations, ScreenHeader, Menu, MoveList } from './common.js';

const BRUSH_STYLE = { green: 'tertiary', red: 'annotation', blue: 'primary', yellow: 'secondary' };
const STYLE_BRUSH = { tertiary: 'green', annotation: 'red', primary: 'blue', secondary: 'yellow' };

function lineThrough(tree, id) {
  const ids = pathIds(tree, id);
  let cur = tree.nodes.get(id);
  while (cur?.children.length) {
    ids.push(cur.children[0]);
    cur = tree.nodes.get(cur.children[0]);
  }
  return ids;
}

/** Board square under a pointer, honouring orientation. */
function squareAt(el, e, orientation) {
  const r = el.getBoundingClientRect();
  const fx = Math.floor(((e.clientX - r.left) / r.width) * 8);
  const fy = Math.floor(((e.clientY - r.top) / r.height) * 8);
  if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
  const file = orientation === 'white' ? fx : 7 - fx;
  const rank = orientation === 'white' ? 7 - fy : fy;
  return 'abcdefgh'[file] + (rank + 1);
}

export function EditorView({ slug, chapterKey, create = false, settings, onClose }) {
  useLibrary();
  const study = create ? null : studyBySlug(slug);
  const chapter = study && (chapterKey ? chaptersOf(study.id).find((c) => c.key === chapterKey) : chaptersOf(study.id)[0]);
  const original = chapter ? treeOf(chapter.id) : null;

  const [tree, setTree] = useState(() => (original ? cloneTree(original) : createTree()));
  const [cursor, setCursor] = useState(() => tree.rootId);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(chapter?.title || 'Chapter 1');
  const [preamble, setPreamble] = useState(chapter?.preamble || '');
  const [studyTitle, setStudyTitle] = useState('');
  const [side, setSide] = useState('white');
  const [draw, setDraw] = useState(false);
  const [sheet, setSheet] = useState(null); // 'paste' | 'start'
  const [resetKey, setResetKey] = useState(0);
  const dragFrom = useRef(null);
  const boardRef = useRef(null);

  // A chapter that loads late (first paint before IndexedDB) replaces the blank tree once.
  const loaded = useRef(!!original);
  useEffect(() => {
    if (!loaded.current && original) {
      loaded.current = true;
      const t = cloneTree(original);
      setTree(t);
      setCursor(t.rootId);
      setTitle(chapter.title);
      setPreamble(chapter.preamble || '');
    }
  }, [original]);

  const node = tree.nodes.get(cursor) || tree.nodes.get(tree.rootId);
  const chess = useMemo(() => load(node.fen), [node.fen, version]);
  const kids = childrenOf(tree, node.id);
  const lineNodes = lineThrough(tree, node.id)
    .slice(1)
    .map((i) => tree.nodes.get(i));
  const touch = () => {
    setVersion((v) => v + 1);
    setDirty(true);
  };

  if (!create && lib().ready && (!study || !chapter)) {
    return html`<main class="sheet-view"><${ScreenHeader} title="Not found" onBack=${onClose} backIcon="close" /><${Empty} title="That chapter isn't on this device" /></main>`;
  }
  if (study && isCurated(study)) {
    return html`<main class="sheet-view"><${ScreenHeader} title=${study.title} onBack=${onClose} backIcon="close" />
      <${Empty} icon="book" title="Curated studies are read-only"><p>Share the PGN and paste it into a new study to make your own copy.</p></${Empty}></main>`;
  }

  const mutateNote = (fn) => {
    const n = tree.nodes.get(node.id);
    const note = n.coach ? { ...n.coach, whyNot: { ...n.coach.whyNot }, arrows: [...n.coach.arrows], marks: [...n.coach.marks] } : emptyNote();
    fn(note);
    n.coach = noteIsEmpty(note) ? null : note;
    touch();
  };

  const onMove = (from, to, promotion) => {
    const uci = from + to + (promotion || '');
    const id = insertChild(tree, node.id, uci);
    if (id) {
      setCursor(id);
      touch();
    } else setResetKey((k) => k + 1);
  };

  // Drawing: drag for an arrow, tap for a mark; drawing the same thing again removes it.
  const toggleArrow = (from, to) =>
    mutateNote((n) => {
      const i = n.arrows.findIndex((a) => a.from === from && a.to === to);
      if (i >= 0) n.arrows.splice(i, 1);
      else n.arrows.push({ from, to, style: 'annotation' });
    });
  const toggleMark = (sq) =>
    mutateNote((n) => {
      const i = n.marks.findIndex((m) => m.square === sq);
      if (i >= 0) n.marks.splice(i, 1);
      else n.marks.push({ square: sq, style: 'tertiary' });
    });
  const orientation = create ? side : study?.side || 'white';
  const onPointerDown = (e) => {
    const sq = squareAt(boardRef.current, e, orientation);
    dragFrom.current = sq;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    const to = squareAt(boardRef.current, e, orientation);
    if (!from || !to) return;
    if (from === to) toggleMark(from);
    else toggleArrow(from, to);
  };
  // Desktop: chessground's own right-drag drawing, folded back into the note.
  const onDraw = (shapes) => {
    mutateNote((n) => {
      n.arrows = shapes.filter((s) => s.dest && s.dest !== s.orig).map((s) => ({ from: s.orig, to: s.dest, style: BRUSH_STYLE[s.brush] || 'annotation' }));
      n.marks = shapes.filter((s) => !s.dest || s.dest === s.orig).map((s) => ({ square: s.orig, style: BRUSH_STYLE[s.brush] || 'tertiary' }));
    });
  };
  const userShapes = [
    ...(node.coach?.arrows || []).map((a) => ({ orig: a.from, dest: a.to, brush: STYLE_BRUSH[a.style] || 'red' })),
    ...(node.coach?.marks || []).map((m) => ({ orig: m.square, brush: STYLE_BRUSH[m.style] || 'green' })),
  ];

  const makeMain = () => {
    if (!confirm('Make this the main line? The drill schedule for this position starts over.')) return;
    promoteToMainline(tree, node.id);
    touch();
  };
  const deleteFrom = () => {
    const n = subtreeCount(tree, node.id);
    if (!confirm(`Delete ${n} move${n === 1 ? '' : 's'} from here?`)) return;
    const parent = node.parent;
    removeSubtree(tree, node.id);
    setCursor(parent);
    touch();
  };

  const save = async () => {
    try {
      if (create) {
        const t = studyTitle.trim() || 'My opening';
        const newSlug = `authored-${hex8()}`;
        await importStudy({
          slug: newSlug,
          title: t,
          side,
          source: { kind: 'authored' },
          chapters: [{ title: title.trim() || 'Chapter 1', key: `${newSlug}-ch0`, order: 0, tree, preamble: preamble.trim() || null }],
        });
        toast('Study created', 'ok');
        go(studyHash(newSlug));
        return;
      }
      await updateChapter(chapter.id, { title: title.trim() || chapter.title, preamble: preamble.trim(), tree: cloneTree(tree) });
      setDirty(false);
      toast('Saved', 'ok');
      go(viewerHash(slug, chapter.key, movesTo(tree, node.id)));
    } catch (e) {
      toast(`Could not save: ${e.message}`, 'error');
    }
  };
  const cancel = () => {
    if (dirty && !confirm('Discard your changes?')) return;
    onClose();
  };

  const deco = decorations(draw ? node.coach : null);
  const policy = node.policy;
  const lastMove = node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined;

  return html`<main class="sheet-view editor prep">
    <${ScreenHeader} title=${create ? 'New study' : `Edit ${chapter?.title || ''}`} subtitle=${create ? 'Play the moves on the board' : study?.title}
      onBack=${cancel} backIcon="close" backLabel="Cancel">
      <${Menu} items=${[
        !create && { label: 'Share chapter PGN', icon: 'share', onClick: () => downloadText(`${chapter.key}.pgn`, exportChapterPgn(chapter.id)) },
        { label: 'Paste PGN into this chapter', icon: 'copy', onClick: () => setSheet('paste') },
        { label: 'Set starting position', icon: 'flag', disabled: tree.nodes.size > 1, onClick: () => setSheet('start') },
      ]} />
      <button class="btn primary small" onClick=${save} disabled=${!create && !dirty}>Save</button>
    </${ScreenHeader}>
    <div class="prep-main">
      <section class="board-col">
        <div class="draw-wrap" ref=${boardRef}>
          <${StudyBoard} settings=${settings} fen=${node.fen} orientation=${orientation} turnColor=${turnOf(node.fen)}
            dests=${draw ? new Map() : destsOf(chess)} viewOnly=${draw} lastMove=${lastMove} check=${chess.inCheck()}
            onMove=${onMove} resetKey=${resetKey + version} drawable=${true} userShapes=${draw ? [] : userShapes} onDraw=${draw ? null : onDraw}
            shapes=${deco.shapes} highlights=${deco.highlights} />
          ${draw ? html`<div class="draw-layer" onPointerDown=${onPointerDown} onPointerUp=${onPointerUp} aria-label="Drawing layer: drag for an arrow, tap for a mark" />` : ''}
        </div>
        <div class="controls transport">
          <${IconButton} icon="first" label="Start" onClick=${() => setCursor(tree.rootId)} disabled=${!node.parent} />
          <${IconButton} icon="prev" label="Back" onClick=${() => node.parent && setCursor(node.parent)} disabled=${!node.parent} />
          <button class=${`btn small ${draw ? 'primary' : ''}`} onClick=${() => setDraw(!draw)} aria-pressed=${draw}><${Icon} name="edit" size=${16} /> Draw</button>
          ${node.coach?.arrows?.length || node.coach?.marks?.length
            ? html`<button class="btn small ghost" onClick=${() => mutateNote((n) => ((n.arrows = []), (n.marks = [])))}>Clear</button>`
            : ''}
          <${IconButton} icon="next" label="Forward" onClick=${() => kids[0] && setCursor(kids[0].id)} disabled=${!kids.length} />
          <${IconButton} icon="last" label="End" onClick=${() => setCursor(lineNodes.at(-1)?.id || node.id)} disabled=${!kids.length} />
        </div>
        ${draw ? html`<p class="hint center">Drag to draw an arrow, tap a square to mark it. Draw it again to remove it.</p>` : ''}
      </section>
      <section class="panel-col">
        <div class="panel-body form">
          ${create
            ? html`<label class="field-label" for="st">Study title</label>
                <input id="st" class="input" value=${studyTitle} placeholder="e.g. My London System" onInput=${(e) => setStudyTitle(e.currentTarget.value)} />
                <label class="field-label">You play</label>
                <${Segmented} value=${side} onChange=${setSide} options=${[
                  { value: 'white', label: 'White' },
                  { value: 'black', label: 'Black' },
                ]} />`
            : ''}
          <label class="field-label" for="ct">Chapter title</label>
          <input id="ct" class="input" value=${title} onInput=${(e) => (setTitle(e.currentTarget.value), setDirty(true))} />

          ${kids.length
            ? html`<div class="variation-chips">${kids.map(
                (k, i) => html`<button class="chip" key=${k.id} onClick=${() => setCursor(k.id)}>${i === 0 ? html`<span class="star">★</span>` : ''}${k.san}</button>`
              )}</div>`
            : ''}
          <${MoveList} moves=${lineNodes} current=${node.id} onJump=${setCursor} />

          ${node.id === tree.rootId
            ? html`<label class="field-label" for="pre">Chapter introduction</label>
                <textarea id="pre" class="input" rows="3" value=${preamble} placeholder="What this chapter is about"
                  onInput=${(e) => (setPreamble(e.currentTarget.value), setDirty(true))} />`
            : html`<div class="card node-card">
                <div class="row between">
                  <b>${node.side === 'white' ? `${Math.floor(node.ply / 2) + 1}.` : `${Math.floor(node.ply / 2)}…`} ${node.san}</b>
                  <div class="row">
                    <button class="btn small ghost" onClick=${makeMain} disabled=${node.main}>Make main line</button>
                    <button class="btn small danger" onClick=${deleteFrom}><${Icon} name="trash" size=${14} /> Delete from here</button>
                  </div>
                </div>
                <label class="field-label" for="why">Why this move?</label>
                <textarea id="why" class="input" rows="2" value=${node.comment || ''} placeholder="A note shown when this move is on the board"
                  onInput=${(e) => ((tree.nodes.get(node.id).comment = e.currentTarget.value || null), touch())} />
                <label class="field-label" for="idea">The idea, in one line</label>
                <input id="idea" class="input" value=${node.coach?.idea || ''} placeholder="Shown while you are asked for this move"
                  onInput=${(e) => mutateNote((n) => (n.idea = e.currentTarget.value || null))} />
                <${WhyNotEditor} node=${node} tree=${tree} onChange=${(whyNot) => mutateNote((n) => (n.whyNot = whyNot))} />
                <label class="field-label">Drilling</label>
                <${Segmented} value=${policy} onChange=${(v) => ((tree.nodes.get(node.id).policy = v), touch())} options=${[
                  { value: POLICY.auto, label: 'Auto' },
                  { value: POLICY.always, label: 'Always' },
                  { value: POLICY.never, label: 'Never' },
                ]} />
                <p class="hint">${policy === POLICY.never
                  ? 'This move and everything after it is shown for understanding but never quizzed.'
                  : policy === POLICY.always
                  ? 'Quizzed even past the usual depth limit of 20 moves.'
                  : 'Quizzed when it is your move, up to move 20.'}</p>
              </div>`}
        </div>
      </section>
    </div>
    <${ChapterPasteSheet} open=${sheet === 'paste'} tree=${tree} onClose=${() => setSheet(null)} onMerged=${() => (setSheet(null), touch())} />
    <${StartPositionSheet} open=${sheet === 'start'} onClose=${() => setSheet(null)} onSet=${(fen) => {
      const t = createTree(fen);
      setTree(t);
      setCursor(t.rootId);
      setSheet(null);
      touch();
    }} />
  </main>`;
}

/** SAN → reason pairs shown when the user plays that move instead of this one. */
function WhyNotEditor({ node, tree, onChange }) {
  const whyNot = node.coach?.whyNot || {};
  const [san, setSan] = useState('');
  const [text, setText] = useState('');
  const parent = tree.nodes.get(node.parent);
  const legal = useMemo(() => (parent ? load(parent.fen)?.moves() || [] : []), [parent?.fen]);
  const add = () => {
    const s = san.trim();
    if (!s || !text.trim()) return;
    if (!legal.includes(s)) {
      toast(`${s} isn't a legal move there`, 'error');
      return;
    }
    onChange({ ...whyNot, [s]: text.trim() });
    setSan('');
    setText('');
  };
  return html`<details class="why-not" open=${Object.keys(whyNot).length > 0}>
    <summary>Why not…? <small class="muted">notes for tempting wrong moves</small></summary>
    <ul class="plain-list">
      ${Object.entries(whyNot).map(
        ([k, v]) => html`<li key=${k} class="list-row"><span class="list-main"><b>${k}</b><small>${v}</small></span>
          <${IconButton} icon="close" label=${`Remove note for ${k}`} onClick=${() => {
            const next = { ...whyNot };
            delete next[k];
            onChange(next);
          }} /></li>`
      )}
    </ul>
    <div class="row gap">
      <input class="input compact" list=${`legal-${node.id}`} placeholder="Move, e.g. Nf3" value=${san} onInput=${(e) => setSan(e.currentTarget.value)} style="max-width:8em" />
      <datalist id=${`legal-${node.id}`}>${legal.filter((m) => m !== node.san).map((m) => html`<option value=${m} />`)}</datalist>
      <input class="input compact" placeholder="Why it fails" value=${text} onInput=${(e) => setText(e.currentTarget.value)} />
      <button class="btn small" onClick=${add}>Add</button>
    </div>
  </details>`;
}

function ChapterPasteSheet({ open, tree, onClose, onMerged }) {
  const [text, setText] = useState('');
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const chapters = parsePgn(text);
      const matching = chapters.filter((c) => c.startFen === tree.rootFen);
      const trial = cloneTree(tree);
      const before = trial.nodes.size;
      for (const c of matching) mergeTree(trial, c.tree);
      return { chapters, matching, added: trial.nodes.size - before, diagnostics: chapters.flatMap((c) => c.diagnostics) };
    } catch (e) {
      return { error: e.message };
    }
  }, [text, open]);
  const merge = () => {
    for (const c of parsed.matching) mergeTree(tree, c.tree);
    setText('');
    toast(`${parsed.added} new move${parsed.added === 1 ? '' : 's'} added`, 'ok');
    onMerged();
  };
  return html`<${Sheet} open=${open} title="Paste PGN into this chapter" onClose=${onClose}>
    <textarea class="input mono" rows="8" placeholder="1. e4 e5 2. Nf3 (2. Bc4) Nc6 …" value=${text} onInput=${(e) => setText(e.currentTarget.value)} />
    ${parsed?.error ? html`<p class="warn">${parsed.error}</p>` : ''}
    ${parsed && !parsed.error
      ? html`<p class="hint">
          ${parsed.matching.length} of ${parsed.chapters.length} game${parsed.chapters.length === 1 ? '' : 's'} start from this chapter's position ·
          <b>${parsed.added} new move${parsed.added === 1 ? '' : 's'}</b>
          ${parsed.matching.length < parsed.chapters.length ? ' · games from a different start are skipped' : ''}
        </p>
        <${Diagnostics} list=${parsed.diagnostics} />`
      : ''}
    <button class="btn primary block" disabled=${!parsed || parsed.error || !parsed.added} onClick=${merge}>Add the moves</button>
  </${Sheet}>`;
}

function StartPositionSheet({ open, onClose, onSet }) {
  const [fen, setFen] = useState(START_FEN);
  const valid = !!load(fen.trim());
  return html`<${Sheet} open=${open} title="Starting position" onClose=${onClose}>
    <label class="field-label" for="fen">FEN</label>
    <textarea id="fen" class="input mono" rows="3" value=${fen} onInput=${(e) => setFen(e.currentTarget.value)} />
    ${!valid ? html`<p class="warn">That isn't a valid position.</p>` : ''}
    <button class="btn primary block" disabled=${!valid} onClick=${() => onSet(load(fen.trim()).fen())}>Use this position</button>
  </${Sheet}>`;
}

export function Diagnostics({ list }) {
  if (!list?.length) return '';
  return html`<ul class="diagnostics">
    ${list.slice(0, 8).map((d) => html`<li class=${d.severity}><${Icon} name="alert" size=${14} /> ${d.message}</li>`)}
    ${list.length > 8 ? html`<li class="muted">…and ${list.length - 8} more</li>` : ''}
  </ul>`;
}

// ---------------------------------------------------------------- details

export function DetailsSheet({ open, study, onClose }) {
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (open && study) {
      setForm({ title: study.title, summary: study.summary || '', eco: study.eco || '', side: study.side, chapters: chaptersOf(study.id).map((c) => ({ id: c.id, title: c.title })), removed: [] });
    }
  }, [open, study?.id]);
  if (!open || !form) return null;
  const set = (patch) => setForm({ ...form, ...patch });
  const move = (i, d) => {
    const ch = form.chapters.slice();
    const [x] = ch.splice(i, 1);
    ch.splice(i + d, 0, x);
    set({ chapters: ch });
  };
  const save = async () => {
    if (!form.title.trim()) return toast('A study needs a title', 'error');
    if (form.side !== study.side && !confirm('Switching sides rebuilds every question, and their scheduling starts over. Continue?')) return;
    try {
      await updateStudy(study.id, { title: form.title.trim(), summary: form.summary.trim(), eco: form.eco.trim(), side: form.side });
      for (const id of form.removed) await deleteChapter(id);
      await reorderChapters(study.id, form.chapters.map((c) => c.id));
      for (const c of form.chapters) {
        const orig = lib().chapters.get(c.id);
        if (orig && c.title.trim() && c.title.trim() !== orig.title) await updateChapter(c.id, { title: c.title.trim() });
      }
      toast('Saved', 'ok');
      onClose();
    } catch (e) {
      toast(`Some changes could not be saved: ${e.message}`, 'error');
    }
  };
  return html`<${Sheet} open=${open} title="Study details" onClose=${onClose}>
    <div class="form">
      <label class="field-label" for="dt">Title</label>
      <input id="dt" class="input" value=${form.title} onInput=${(e) => set({ title: e.currentTarget.value })} />
      <label class="field-label" for="ds">Summary</label>
      <textarea id="ds" class="input" rows="2" value=${form.summary} onInput=${(e) => set({ summary: e.currentTarget.value })} />
      <label class="field-label" for="de">ECO</label>
      <input id="de" class="input" value=${form.eco} placeholder="e.g. B10-B19" onInput=${(e) => set({ eco: e.currentTarget.value })} />
      <label class="field-label">You play</label>
      <${Segmented} value=${form.side} onChange=${(v) => set({ side: v })} options=${[
        { value: 'white', label: 'White' },
        { value: 'black', label: 'Black' },
      ]} />
      ${form.side !== study.side ? html`<p class="warn">The questions are rebuilt for the other side and scheduling starts over.</p>` : ''}
      <label class="field-label">Chapters</label>
      <ul class="plain-list reorder">
        ${form.chapters.map(
          (c, i) => html`<li key=${c.id} class="list-row">
            <input class="input compact" value=${c.title} aria-label="Chapter title"
              onInput=${(e) => set({ chapters: form.chapters.map((x) => (x.id === c.id ? { ...x, title: e.currentTarget.value } : x)) })} />
            <${IconButton} icon="up" label="Move up" disabled=${i === 0} onClick=${() => move(i, -1)} />
            <${IconButton} icon="down" label="Move down" disabled=${i === form.chapters.length - 1} onClick=${() => move(i, 1)} />
            <${IconButton} icon="trash" label="Delete chapter" disabled=${form.chapters.length === 1}
              onClick=${() => set({ chapters: form.chapters.filter((x) => x.id !== c.id), removed: [...form.removed, c.id] })} />
          </li>`
        )}
      </ul>
      <button class="btn primary block" onClick=${save}>Save</button>
    </div>
  </${Sheet}>`;
}

export { mainline, nodeAtPath, styleOfLetter, letterOfStyle, editorHash };
