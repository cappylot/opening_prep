// Learn mode for one chapter (port of StudyViewerScreen / StudyViewerModel):
// step through the book, pick variations, play book moves on the board.
import { useState, useEffect, useMemo, useRef } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Empty, toast } from '../../ui.js';
import { go, viewerHash, editorHash, studyHash } from '../../route.js';
import { studyBySlug, chaptersOf, treeOf, isCurated } from '../../study/studyStore.js';
import { childrenOf, pathIds, rootOf, nodeAtPath, movesTo } from '../../study/movetree.js';
import { load, destsOf, turnOf } from '../../study/chess.js';
import { startDrill, setReading } from '../../study/session.js';
import { useLibrary, StudyBoard, decorations, ScreenHeader, SidePip, MoveList } from './common.js';
import { drillOptions } from './common.js';
import { AnalyzeSheet } from './analyze.js';

/** Follows `preferred` where it continues from `id`, else the mainline, to a leaf. */
function lineThrough(tree, id, preferred) {
  const ids = pathIds(tree, id);
  let cur = tree.nodes.get(id);
  const seen = new Set(ids);
  while (cur?.children.length) {
    const next = preferred.find((p) => cur.children.includes(p)) || cur.children[0];
    if (seen.has(next)) break;
    seen.add(next);
    ids.push(next);
    cur = tree.nodes.get(next);
  }
  return ids;
}

export function ViewerView({ slug, chapterKey, moves, settings, onClose }) {
  const lib = useLibrary();
  const study = studyBySlug(slug);
  const chapter = study && chaptersOf(study.id).find((c) => c.key === chapterKey);
  const tree = chapter ? treeOf(chapter.id) : null;

  const [cursor, setCursor] = useState(() => (tree ? nodeAtPath(tree, moves).id : null));
  const [line, setLine] = useState([]);
  const [flipped, setFlipped] = useState(false);
  const [hint, setHint] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [flash, setFlash] = useState(null);
  const [analyze, setAnalyze] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (study) setReading(study.id);
  }, [study?.id]);
  useEffect(() => {
    if (tree && (!cursor || !tree.nodes.has(cursor))) setCursor(nodeAtPath(tree, moves).id);
  }, [tree, chapter?.updated]);

  const node = tree && cursor ? tree.nodes.get(cursor) : null;
  const ids = useMemo(() => (tree && node ? lineThrough(tree, node.id, line) : []), [tree, node?.id, line.join(), chapter?.updated]);
  const lineNodes = ids.slice(1).map((i) => tree.nodes.get(i));
  const kids = node ? childrenOf(tree, node.id) : [];
  const nextId = ids[ids.indexOf(node?.id) + 1];

  // Keep the URL shareable, as the prep view does.
  useEffect(() => {
    if (!tree || !node) return;
    history.replaceState(null, '', viewerHash(slug, chapterKey, movesTo(tree, node.id)));
    setHint(false);
  }, [node?.id]);

  const step = (id) => {
    if (!id) return;
    setCursor(id);
    const path = lineThrough(tree, id, line);
    setLine(path);
  };
  const forward = () => nextId && step(nextId);
  const backStep = () => node?.parent && setCursor(node.parent);
  const toStart = () => setCursor(tree.rootId);
  const toEnd = () => setCursor(ids[ids.length - 1]);

  // Autoplay: one move per animation + 0.5 s, stopping at the end of the line.
  useEffect(() => {
    if (!playing) return;
    if (!nextId) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(forward, (settings.animation + 0.5) * 1000);
    return () => clearTimeout(t);
  }, [playing, node?.id, nextId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input,textarea,select')) return;
      if (e.key === 'ArrowRight') forward();
      else if (e.key === 'ArrowLeft') backStep();
      else if (e.key === 'ArrowUp') toStart();
      else if (e.key === 'ArrowDown') toEnd();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const chess = useMemo(() => (node ? load(node.fen) : null), [node?.fen]);

  if (!lib.ready) return html`<main class="sheet-view"><div class="center-wrap"><div class="spinner-lg">♞</div></div></main>`;
  if (!tree || !node)
    return html`<main class="sheet-view"><${ScreenHeader} title="Chapter not found" onBack=${onClose} backIcon="close" />
      <${Empty} icon="book" title="This chapter isn't on this device" /></main>`;

  const onMove = (from, to, promotion) => {
    const uci = from + to + (promotion || '');
    const book = kids.find((k) => k.uci === uci || k.uci === from + to + 'q');
    if (book) {
      setLine(lineThrough(tree, book.id, [book.id, ...line]));
      setCursor(book.id);
      return;
    }
    // Only book moves advance; anything else flashes where it came from.
    setFlash(from);
    setResetKey((k) => k + 1);
    setTimeout(() => setFlash(null), 800);
  };

  const orientation = flipped ? (study.side === 'white' ? 'black' : 'white') : study.side;
  const note = node.coach;
  const nextNode = nextId && tree.nodes.get(nextId);
  const deco = decorations(note, flash ? { [flash]: 'flash' } : {});
  if (hint && nextNode) deco.shapes.push({ orig: nextNode.uci.slice(0, 2), dest: nextNode.uci.slice(2, 4), brush: 'hint' });
  const total = lineNodes.length;
  const lastMove = node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined;
  const text = node.id === tree.rootId ? chapter.preamble : node.comment;
  const drill = () => {
    if (!startDrill({ kind: 'chapter', chapter: chapter.id }, drillOptions(settings))) toast('Nothing to drill in this chapter yet', 'error');
    else go('#/drill');
  };

  return html`<main class="sheet-view viewer prep">
    <${ScreenHeader} title=${chapter.title} subtitle=${study.title} onBack=${() => go(studyHash(slug))} backLabel="Back to study">
      <${IconButton} icon="flip" label="Flip board" onClick=${() => setFlipped(!flipped)} />
      <${IconButton} icon="bulb" label="Hint: show the next book move" class=${hint ? 'accent' : ''} onClick=${() => setHint(!hint)} disabled=${!nextNode} />
      <${IconButton} icon="cpu" label="Analyse position" onClick=${() => setAnalyze(true)} />
      ${!isCurated(study) ? html`<${IconButton} icon="edit" label="Edit moves" onClick=${() => go(editorHash(slug, chapterKey))} />` : ''}
      <${IconButton} icon="close" label="Close" onClick=${onClose} />
    </${ScreenHeader}>
    <div class="prep-main">
      <section class="board-col">
        <div class="status-row">
          <${SidePip} side=${study.side} />
          <span>${node.ply ? `Move ${node.ply} of ${total}` : `${total} moves in this line`}</span>
          ${kids.length > 1 ? html`<span class="pill">${kids.length} options</span>` : ''}
        </div>
        <${StudyBoard} settings=${settings} fen=${node.fen} orientation=${orientation} turnColor=${turnOf(node.fen)}
          dests=${chess ? destsOf(chess) : new Map()} lastMove=${lastMove} check=${chess?.inCheck()} shapes=${deco.shapes}
          highlights=${deco.highlights} onMove=${onMove} resetKey=${resetKey} />
        <div class="controls transport">
          <${IconButton} icon="first" label="Start" onClick=${toStart} disabled=${!node.parent} />
          <${IconButton} icon="prev" label="Back" onClick=${backStep} disabled=${!node.parent} />
          <${IconButton} icon=${playing ? 'pause' : 'play'} label=${playing ? 'Pause' : 'Play'} onClick=${() => setPlaying(!playing)} disabled=${!nextId && !playing} />
          <${IconButton} icon="next" label="Forward" onClick=${forward} disabled=${!nextId} />
          <${IconButton} icon="last" label="End of line" onClick=${toEnd} disabled=${!nextId} />
        </div>
      </section>
      <section class="panel-col">
        <div class="panel-body">
          ${text || note?.idea
            ? html`<div class="card annotation">
                ${text ? html`<p>${text}</p>` : ''}
                ${note?.idea ? html`<p class="idea"><${Icon} name="bulb" size=${16} /> ${note.idea}</p>` : ''}
              </div>`
            : ''}
          ${kids.length
            ? html`<div class="variation-chips" role="group" aria-label="Continuations">
                ${kids.map(
                  (k, i) => html`<button key=${k.id} class=${`chip ${k.id === nextId ? 'on' : ''}`} onClick=${() => (setLine(lineThrough(tree, k.id, [k.id])), setCursor(k.id))}>
                    ${i === 0 ? html`<span class="star" aria-label="Main line">★</span>` : ''}${k.side === 'white' ? `${Math.floor(k.ply / 2) + 1}.` : `${Math.floor(k.ply / 2)}…`} ${k.san}
                  </button>`
                )}
              </div>`
            : html`<p class="hint">End of this line.</p>`}
          <${MoveList} moves=${lineNodes} current=${node.id} onJump=${(id) => setCursor(id)} />
          <button class="btn primary block" onClick=${drill}><${Icon} name="target" size=${18} /> Drill this chapter</button>
        </div>
      </section>
    </div>
    <${AnalyzeSheet} open=${analyze} fen=${node.fen} settings=${settings} onClose=${() => setAnalyze(false)} />
  </main>`;
}

export { rootOf };
