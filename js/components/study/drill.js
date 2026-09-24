// The drill player and its summary (ports of DrillPlayerView and DrillSummaryScreen).
import { useState, useEffect, useMemo } from '../../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Empty, vibrate } from '../../ui.js';
import { go, studyHash } from '../../route.js';
import { endDrill, dismissSummary } from '../../study/session.js';
import { toggleBookmark, lib } from '../../study/studyStore.js';
import { load, destsOf, turnOf } from '../../study/chess.js';
import { verdict } from '../../study/metrics.js';
import { useActiveSession, useLibrary, StudyBoard, Cover, Ring, Menu, ProgressBar } from './common.js';
import { AnalyzeSheet } from './analyze.js';

const sideLabel = (s) => (s === 'white' ? 'White' : 'Black');

function banner(s) {
  const p = s.phase;
  const idea = s.prompt?.idea;
  switch (p.kind) {
    case 'feedback':
      if (p.result === 'correct') return { tone: 'good', title: `Correct — ${p.san}`, sub: s.lastReplySan ? `The book replies ${s.lastReplySan}` : idea || '' };
      if (p.result === 'wrong') return { tone: 'bad', title: `${p.played} isn't the book move`, sub: p.why || `Play ${p.expected} to continue` };
      return { tone: 'info', title: `The move is ${p.san}`, sub: s.lastReplySan ? `The book replies ${s.lastReplySan}` : '' };
    case 'offLine':
      return { tone: 'warn', title: `${p.played} is playable, but this line plays ${p.lineMove}`, sub: 'Play the line move to continue' };
    case 'teachBack':
      return { tone: 'info', title: `Play ${p.san} to continue`, sub: 'The arrow shows the move' };
    case 'awaitingMove':
      return { tone: 'plain', title: `${sideLabel(s.board.orientation)} to play`, sub: idea || 'Find the book move' };
    case 'playingLine':
    case 'preparing':
      return { tone: 'plain', title: 'Playing the line', sub: '' };
    case 'lineComplete':
      return p.cutShort
        ? { tone: 'warn', title: "This line couldn't be played out", sub: 'A stored move is not legal here' }
        : { tone: 'good', title: 'Line complete', sub: `${s.correctInLine} of ${s.promptCountInLine} first try` };
    default:
      return { tone: 'plain', title: '', sub: '' };
  }
}

const PRIMARY = { endDrill: 'End drill', automatic: 'End drill', nextMove: 'Continue', nextLine: 'Next line', finish: 'Finish', done: 'Done' };

export function DrillView({ settings, onClose }) {
  const active = useActiveSession();
  useLibrary();
  const s = active.session;
  const [analyze, setAnalyze] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (!s || e.target.closest?.('input,textarea,select')) return;
      if (e.key === 'h') s.hint();
      else if (e.key === 'Enter' || e.key === ' ') s.primary();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  useEffect(() => {
    if (!s || !settings.haptics) return;
    if (s.phase.kind === 'feedback' && s.phase.result === 'wrong') vibrate([30, 40, 30]);
    else if (s.phase.kind === 'feedback' && s.phase.result === 'correct') vibrate(12);
  }, [s?.phase]);

  const chess = useMemo(() => (s ? load(s.board.fen) : null), [s?.board.fen, s?.board.version]);

  if (!s || s.finished) {
    const summary = active.summary || s?.phase.summary;
    if (summary) return html`<${DrillSummary} summary=${summary} onDone=${() => (dismissSummary(), onClose())} />`;
    return html`<main class="sheet-view"><${Empty} icon="target" title="No drill running">
      <button class="btn primary" onClick=${onClose}>Back</button></${Empty}></main>`;
  }

  const line = s.line;
  const b = s.board;
  const turn = turnOf(b.fen);
  const answering = b.policy === 'answering' && s.awaitingInput;
  const premoving = b.policy === 'premoving';
  const highlights = new Map();
  for (const m of b.marks) highlights.set(m.square, 'mark');
  for (const sq of b.hint) highlights.set(sq, 'hint');
  if (b.flash) highlights.set(b.flash, 'flash');
  const shapes = b.arrows.map((a) => ({ orig: a.from, dest: a.to, brush: 'deco' }));
  const msg = banner(s);
  const bookmarkCard = s.prompt?.grading?.card;
  const bookmarked = bookmarkCard && lib().bookmarks.has(bookmarkCard);
  const collapse = () => go(line ? studyHash(lib().studies.get(line.study)?.slug || '') : '#/');

  return html`<main class="sheet-view drill-player prep">
    <header class="topbar study-top">
      <${IconButton} icon="chevron-down" label="Collapse" onClick=${() => history.length > 1 ? history.back() : collapse()} />
      <${Cover} seed=${line?.coverSeed || 0} side=${line?.side} size=${36} />
      <div class="opp-card">
        <span class="opp-name">${line?.studyTitle || 'Drill'}</span>
        <small>${line?.chapterTitle || ''}</small>
      </div>
      <${IconButton} icon="bookmark" label=${bookmarked ? 'Remove bookmark' : 'Bookmark this position'} class=${bookmarked ? 'accent filled' : ''}
        disabled=${!bookmarkCard} onClick=${() => toggleBookmark(bookmarkCard, { study: line.study, fen: s.prompt.promptFen, san: s.prompt.answerSan })} />
      <${Menu} items=${[
        { label: 'Analyse position', icon: 'cpu', onClick: () => setAnalyze(true) },
        { label: 'Collapse', icon: 'chevron-down', onClick: collapse },
        { label: 'Close', icon: 'close', danger: true, onClick: () => (endDrill(), onClose()) },
      ]} />
    </header>
    <div class="prep-main">
      <section class="board-col">
        <div class="drill-progress">
          <${ProgressBar} value=${s.progress} />
          <div class="row between">
            <small>Line ${Math.min(s.lineIndex + 1, s.lineCount)} of ${s.lineCount} · move ${s.promptNumberInLine} of ${s.promptCountInLine}</small>
            <small>${Math.round(s.accuracy * 100)}% correct</small>
          </div>
        </div>
        <${StudyBoard} settings=${settings} fen=${b.fen} orientation=${b.orientation} turnColor=${turn}
          dests=${answering && chess ? destsOf(chess) : new Map()} movableColor=${answering ? turn : premoving ? b.orientation : undefined}
          viewOnly=${!answering && !premoving} lastMove=${b.lastMove || undefined} check=${chess?.inCheck()}
          shapes=${shapes} highlights=${highlights} resetKey=${b.version}
          onMove=${(from, to, promotion) => s.handle({ from, to, promotion, drag: true })}
          onPremove=${(from, to) => from && s.handle({ from, to })} />
        <div class=${`drill-banner ${msg.tone}`} role="status" aria-live="polite">
          <b>${msg.title}</b>
          <small>${msg.sub}</small>
        </div>
      </section>
      <section class="panel-col">
        <div class="panel-body">
          <div class="trail drill-trail">${s.playedSan.length ? s.playedSan.map((san, i) => html`${i % 2 === 0 ? html`<span class="trail-num">${i / 2 + 1}.</span>` : ''}<span class="trail-move">${san}</span>`) : 'Starting position'}</div>
          <div class="drill-controls">
            <button class="btn" onClick=${() => s.hint()} disabled=${!s.acceptsHint}><${Icon} name="bulb" size=${18} /> Hint</button>
            <button class="btn" onClick=${() => s.reveal()} disabled=${!(s.acceptsHint || (s.phase.kind === 'feedback' && s.phase.result === 'wrong'))}>
              <${Icon} name="eye" size=${18} /> Answer</button>
            <button class="btn" onClick=${() => s.skip()} disabled=${!s.awaitingInput}><${Icon} name="skip" size=${18} /> Skip</button>
          </div>
          <button class=${`btn block ${['nextLine', 'finish', 'nextMove'].includes(s.continuation) ? 'primary' : ''}`} onClick=${() => {
            if (s.continuation === 'endDrill' || s.continuation === 'automatic') endDrill();
            else s.primary();
          }}>${PRIMARY[s.continuation]}</button>
        </div>
      </section>
    </div>
    <${AnalyzeSheet} open=${analyze} fen=${b.fen} settings=${settings} onClose=${() => setAnalyze(false)} />
  </main>`;
}

const fmtTime = (sec) => (sec < 60 ? `${Math.round(sec)}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s`);

export function DrillSummary({ summary, onDone }) {
  const a = summary.accuracy;
  const tone = a >= 0.8 ? 'good' : a >= 0.5 ? 'accent' : 'bad';
  return html`<main class="sheet-view drill-summary-view">
    <div class="summary-body">
      <${Cover} seed=${summary.coverSeed} size=${56} />
      <h2>${summary.completed ? 'Drill complete' : 'Drill ended'}</h2>
      <p class="muted">${summary.title}${summary.subtitle ? ` · ${summary.subtitle}` : ''}</p>
      <${Ring} value=${a} size=${132} stroke=${11} class=${tone} label=${`${Math.round(a * 100)}%`} />
      <p class="verdict">${summary.total ? verdict(a) : 'Nothing answered this time.'}</p>
      <div class="stat-tiles">
        <div class="tile"><b>${summary.correct}/${summary.total}</b><small>First try</small></div>
        <div class="tile"><b>${summary.hints}</b><small>Hints</small></div>
        <div class="tile"><b>${fmtTime(summary.elapsed)}</b><small>Time</small></div>
      </div>
      ${!summary.completed ? html`<p class="hint center">${summary.linesPlayed} of ${summary.lineCount} lines</p>` : ''}
      <button class="btn primary block" onClick=${onDone}>Done</button>
    </div>
  </main>`;
}
