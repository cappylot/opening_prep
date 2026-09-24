// "My lines": saved prep lines per opponent, PGN export and drill mode.
import { useEffect, useMemo, useState, useRef } from '../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Sheet, Empty, toast, vibrate, downloadText, shareOrCopy, shortDate } from '../ui.js';
import { Board, destsOf } from '../board.js';
import { formatLine, playPath, fenKey, rankedMoves } from '../tree.js';
import { putLine, deleteLine } from '../store.js';

export function toPgn(lines, oppName) {
  return lines
    .map((l) => {
      const white = l.color === 'white' ? 'Me' : oppName;
      const black = l.color === 'white' ? oppName : 'Me';
      const tags = [
        ['Event', `Prep vs ${oppName}: ${l.name}`],
        ['Site', 'Opening Prep'],
        ['Date', new Date(l.created).toISOString().slice(0, 10).replace(/-/g, '.')],
        ['White', white],
        ['Black', black],
        ['Result', '*'],
      ];
      const head = tags.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n');
      const note = l.note ? `{ ${l.note.replace(/[{}]/g, '')} } ` : '';
      return `${head}\n\n${note}${formatLine(l.sans)} *\n`;
    })
    .join('\n');
}

export function LinesPanel({ lines, allCount, myColor, oppName, onOpen, onDrill, onEdit, onChanged, onSaveCurrent }) {
  const remove = async (l) => {
    if (!confirm(`Delete “${l.name}”?`)) return;
    await deleteLine(l.id);
    onChanged();
    toast('Line deleted');
  };
  const exportPgn = async () => {
    const pgn = toPgn(lines, oppName);
    const file = `prep-vs-${oppName}-${myColor}.pgn`;
    try {
      const f = new File([pgn], file, { type: 'application/x-chess-pgn' });
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title: file });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    downloadText(file, pgn);
  };

  if (!lines.length) {
    return html`<${Empty} icon="bookmark" title="No saved lines yet">
      <p>Explore a line on the board, then tap <${Icon} name="bookmark" size=${14} /> to save it as your prep for playing ${myColor} against ${oppName}.
        Saved lines can be drilled and exported as PGN.</p>
      ${allCount ? html`<p class="hint">You have ${allCount} line${allCount === 1 ? '' : 's'} saved for the other colour.</p>` : ''}
      ${onSaveCurrent ? html`<button class="btn primary" onClick=${onSaveCurrent}><${Icon} name="bookmark" size=${16} /> Save current line</button>` : ''}
    </${Empty}>`;
  }

  return html`<div class="lines">
    <div class="lines-actions">
      <button class="btn primary" onClick=${() => onDrill(lines)}><${Icon} name="target" size=${16} /> Drill ${lines.length} line${lines.length === 1 ? '' : 's'}</button>
      <button class="btn" onClick=${exportPgn}><${Icon} name="download" size=${16} /> PGN</button>
      <button class="btn" onClick=${() => shareOrCopy({ text: toPgn(lines, oppName) })} aria-label="Copy PGN"><${Icon} name="copy" size=${16} /></button>
    </div>
    <ul class="line-list">
      ${lines.map(
        (l) => html`<li key=${l.id} class="saved-line">
          <button class="saved-main" onClick=${() => onOpen(l)}>
            <b>${l.name}</b>
            <span class="line-moves">${formatLine(l.sans)}</span>
            ${l.note ? html`<span class="note">${l.note}</span>` : ''}
            <small class="muted">Saved ${shortDate(l.created)}</small>
          </button>
          <div class="saved-actions">
            <${IconButton} icon="target" label="Drill this line" onClick=${() => onDrill([l])} />
            <${IconButton} icon="edit" label="Edit" onClick=${() => onEdit(l)} />
            <${IconButton} icon="trash" label="Delete" onClick=${() => remove(l)} />
          </div>
        </li>`
      )}
    </ul>
  </div>`;
}

export function SaveLineSheet({ open, onClose, edit, path, sans, opening, oppId, oppName, myColor, onSaved }) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(edit?.name || opening?.name || `Line vs ${oppName}`);
    setNote(edit?.note || '');
  }, [open, edit]);

  const save = async (e) => {
    e.preventDefault();
    const line = edit
      ? { ...edit, name: name.trim() || edit.name, note: note.trim() }
      : { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, opp: oppId, color: myColor, path: [...path], sans: [...sans], name: name.trim() || 'Untitled line', note: note.trim(), created: Date.now() };
    await putLine(line);
    toast(edit ? 'Line updated' : 'Line saved', 'ok');
    onSaved();
  };

  return html`<${Sheet} open=${open} title=${edit ? 'Edit line' : 'Save line'} onClose=${onClose}>
    <form class="form" onSubmit=${save}>
      <p class="line-moves boxed">${formatLine(sans)}</p>
      <p class="hint">You play ${myColor} against ${oppName}.</p>
      <label class="field-label" for="line-name">Name</label>
      <input id="line-name" class="input" value=${name} maxlength="80" onInput=${(e) => setName(e.currentTarget.value)} />
      <label class="field-label" for="line-note">Notes</label>
      <textarea id="line-note" class="input" rows="3" placeholder="Plans, traps, what to remember…" value=${note}
        onInput=${(e) => setNote(e.currentTarget.value)} />
      <button class="btn primary block" type="submit"><${Icon} name="check" size=${16} /> ${edit ? 'Update' : 'Save'}</button>
    </form>
  </${Sheet}>`;
}

// ---- drill ----

/** Trie of saved lines: key = uci prefix joined with ',' → Set of next moves. */
function buildTrie(lines) {
  const next = new Map();
  for (const l of lines) {
    for (let i = 0; i < l.path.length; i++) {
      const k = l.path.slice(0, i).join(',');
      if (!next.has(k)) next.set(k, new Set());
      next.get(k).add(l.path[i]);
    }
  }
  return next;
}

function pickWeighted(options, tree, fen) {
  const ranked = rankedMoves(tree?.nodes.get(fenKey(fen)));
  const weights = options.map((u) => ranked.find((m) => m.uci === u)?.w || 0.1);
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

export function DrillView({ lines, tree, myColor, oppName, settings, onExit }) {
  const trie = useMemo(() => buildTrie(lines), [lines]);
  const [path, setPath] = useState([]);
  const [stats, setStats] = useState({ correct: 0, wrong: 0, runs: 0 });
  const [status, setStatus] = useState('play'); // play | wrong | done
  const [hint, setHint] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [shake, setShake] = useState(false);
  const timer = useRef(null);

  const { chess } = useMemo(() => playPath(path), [path.join(',')]);
  const fen = chess.fen();
  const options = [...(trie.get(path.join(',')) || [])];
  const turnColor = chess.turn() === 'w' ? 'white' : 'black';
  const myTurn = turnColor === myColor;
  const last = chess.history({ verbose: true }).slice(-1)[0];

  useEffect(() => {
    clearTimeout(timer.current);
    if (status !== 'play') return;
    if (!options.length) {
      setStatus('done');
      setStats((s) => ({ ...s, runs: s.runs + 1 }));
      if (settings.haptics) vibrate([10, 40, 10]);
      return;
    }
    if (!myTurn) {
      timer.current = setTimeout(() => setPath((p) => [...p, pickWeighted(options, tree, fen)]), 550);
    }
    return () => clearTimeout(timer.current);
  }, [path.join(','), status]);

  const onMove = (orig, dest) => {
    if (!myTurn || status !== 'play') return setResetKey((k) => k + 1);
    const m = chess.moves({ verbose: true }).find((x) => x.from === orig && x.to === dest && (!x.promotion || x.promotion === 'q'));
    const uci = m ? m.from + m.to + (m.promotion || '') : orig + dest;
    if (options.includes(uci)) {
      setHint(null);
      setStats((s) => ({ ...s, correct: s.correct + 1 }));
      setPath((p) => [...p, uci]);
      if (settings.haptics) vibrate(8);
    } else {
      setStats((s) => ({ ...s, wrong: s.wrong + 1 }));
      setHint(options[0]);
      setStatus('wrong');
      setShake(true);
      if (settings.haptics) vibrate([30, 50, 30]);
      setTimeout(() => setShake(false), 400);
      setTimeout(() => {
        setResetKey((k) => k + 1);
        setStatus('play');
      }, 900);
    }
  };

  const restart = () => {
    setPath([]);
    setHint(null);
    setStatus('play');
    setResetKey((k) => k + 1);
  };

  const shapes = hint ? [{ orig: hint.slice(0, 2), dest: hint.slice(2, 4), brush: 'hint' }] : [];
  const total = stats.correct + stats.wrong;
  const { sans } = playPath(path);
  const message =
    status === 'done'
      ? 'Line complete!'
      : status === 'wrong'
      ? 'Not your prep move. Try again'
      : myTurn
      ? hint
        ? 'Play the highlighted move'
        : 'Your move: play your prep'
      : `${oppName} is thinking…`;

  return html`<main class="prep drill">
    <header class="topbar">
      <${IconButton} icon="close" label="Exit drill" onClick=${onExit} />
      <div class="opp-card"><span class="opp-name">Drill vs ${oppName}</span><small>${lines.length} line${lines.length === 1 ? '' : 's'} · you play ${myColor}</small></div>
      <div class="drill-score" title="Correct moves this session">${total ? `${Math.round((stats.correct / total) * 100)}%` : '–'}</div>
    </header>
    <div class="prep-main">
      <section class="board-col">
        <div class=${`drill-status ${status}`}>${message}</div>
        <div class=${shake ? 'shake' : ''}>
          <${Board} fen=${fen} orientation=${myColor} turnColor=${turnColor} dests=${myTurn && status === 'play' ? destsOf(chess) : new Map()}
            lastMove=${last ? [last.from, last.to] : undefined} check=${chess.inCheck()} shapes=${shapes} onMove=${onMove}
            coords=${settings.coords} resetKey=${resetKey} theme=${settings.board} />
        </div>
        <div class="trail drill-trail">${sans.length ? formatLine(sans) : 'Starting position'}</div>
      </section>
      <section class="panel-col">
        <div class="panel-body">
          <div class="card drill-card">
            <div class="stat-row">
              <div class="stat"><b>${stats.correct}</b><small>correct</small></div>
              <div class="stat"><b>${stats.wrong}</b><small>mistakes</small></div>
              <div class="stat"><b>${stats.runs}</b><small>lines done</small></div>
            </div>
            ${status === 'done'
              ? html`<button class="btn primary block" onClick=${restart}><${Icon} name="refresh" size=${16} /> Next run</button>`
              : html`<button class="btn block" onClick=${restart}><${Icon} name="refresh" size=${16} /> Restart</button>`}
            <p class="hint">${oppName}'s moves are picked in proportion to how often they actually play them, so you'll see their favourites most.</p>
          </div>
        </div>
      </section>
    </div>
  </main>`;
}
