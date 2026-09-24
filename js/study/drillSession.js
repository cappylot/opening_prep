// Runs one drill (port of DrillSession.swift): plays each line of the plan from
// its first move to its last, quizzing every move of the user's own. The session
// owns the position and a small board model the view renders; timing goes
// through an injectable clock so tests run instantly.
import { load, playUci, uciOf } from './chess.js';
import { gradeFor } from './srs.js';

const BOOK_GAP = 0.12;
const READING_BEAT = 0.25;

export const realClock = {
  sleep: (s) => new Promise((r) => setTimeout(r, Math.max(0, s * 1000))),
  now: () => Date.now(),
};

/**
 * phase.kind: idle | preparing | playingLine | awaitingMove | feedback
 * ({result: correct|wrong|revealed, san, played, expected}) | teachBack ({san})
 * | offLine ({played, lineMove}) | lineComplete ({cutShort}) | finished ({summary}).
 */
export class DrillSession {
  constructor(plan, { clock = realClock, animation = 0.2, manualPacing = () => false, commit = () => {}, onChange = () => {} } = {}) {
    this.plan = plan;
    this.clock = clock;
    this.animation = animation;
    this.manualPacing = manualPacing;
    this.commit = commit;
    this.listeners = new Set([onChange]);
    this.phase = { kind: 'idle' };
    this.lineIndex = 0;
    this.ply = 0;
    this.prompt = null;
    this.answered = 0;
    this.correct = 0;
    this.correctInLine = 0;
    this.hints = 0;
    this.attempts = 0;
    this.hintLevel = 0;
    this.usedHint = false;
    this.continuation = 'endDrill';
    this.lastReplySan = null;
    this.premove = null;
    this.graded = new Set();
    this.byPly = new Map();
    this.gen = 0;
    this.startedAt = clock.now();
    this.promptStartedAt = null;
    const first = plan.lines[0];
    this.board = {
      fen: first?.startFen,
      lastMove: null,
      orientation: first?.side || 'white',
      policy: 'readOnly',
      arrows: [],
      marks: [],
      hint: [],
      flash: null,
      waiting: false,
      version: 0,
    };
    this.chess = load(first?.startFen);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.board.version += 1;
    for (const fn of this.listeners) fn(this);
  }

  // ---------------------------------------------------------------- derived

  get line() {
    return this.plan.lines[this.lineIndex] || null;
  }
  get lineCount() {
    return this.plan.lines.length;
  }
  get promptCount() {
    return this.plan.lines.reduce((n, l) => n + l.prompts.length, 0);
  }
  get promptCountInLine() {
    return this.byPly.size;
  }
  get promptNumberInLine() {
    if (!this.byPly.size) return 0;
    const behind = [...this.byPly.keys()].filter((k) => k < this.ply).length;
    return Math.min(behind + 1, this.byPly.size);
  }
  get progress() {
    return this.promptCount ? this.answered / this.promptCount : 0;
  }
  get accuracy() {
    return this.answered ? this.correct / this.answered : 1;
  }
  get finished() {
    return this.phase.kind === 'finished';
  }
  get promptAtCursor() {
    return this.byPly.get(this.ply) || null;
  }
  get hasMovesLeft() {
    return this.ply < (this.line?.movesUci.length || 0);
  }
  get hasPromptAhead() {
    for (const k of this.byPly.keys()) if (k >= this.ply) return true;
    return false;
  }
  get acceptsPremove() {
    const k = this.phase.kind;
    return (k === 'feedback' && this.phase.result !== 'wrong') || k === 'playingLine';
  }
  get awaitingInput() {
    const k = this.phase.kind;
    return k === 'awaitingMove' || k === 'teachBack' || k === 'offLine' || (k === 'feedback' && this.phase.result === 'wrong');
  }
  get acceptsHint() {
    return this.phase.kind === 'awaitingMove' || this.phase.kind === 'offLine';
  }
  /** Moves on the board so far, for the move strip. */
  get playedSan() {
    return this.line ? this.line.movesSan.slice(0, this.ply) : [];
  }
  get studyIds() {
    return new Set(this.plan.lines.map((l) => l.study));
  }

  // ---------------------------------------------------------------- lifecycle

  start() {
    if (!this.plan.lines.length) {
      this.continuation = 'done';
      this.phase = { kind: 'finished', summary: this.summary(true) };
      this.emit();
      return;
    }
    this.startedAt = this.clock.now();
    this.lineIndex = 0;
    this.answered = this.correct = this.hints = 0;
    this.graded = new Set();
    this.beginLine();
  }

  stop() {
    this.cancel();
    this.premove = null;
    this.continuation = 'endDrill';
    this.phase = { kind: 'idle' };
    this.emit();
  }

  finish(completed = false) {
    this.cancel();
    this.premove = null;
    this.continuation = 'done';
    this.phase = { kind: 'finished', summary: this.summary(completed) };
    this.emit();
  }

  cancel() {
    this.gen += 1;
  }

  // ---------------------------------------------------------------- lines

  beginLine() {
    const line = this.line;
    if (!line) {
      this.finish(true);
      return;
    }
    this.cancel();
    Object.assign(this, { attempts: 0, hintLevel: 0, usedHint: false, correctInLine: 0, prompt: null, continuation: 'endDrill', lastReplySan: null, premove: null });
    this.byPly = new Map();
    for (const p of line.prompts) if (line.movesUci[p.ply] === p.answerUci) this.byPly.set(p.ply, p);
    Object.assign(this.board, { arrows: [], marks: [], hint: [], flash: null, policy: 'readOnly', orientation: line.side });
    this.phase = { kind: 'preparing' };
    this.chess = load(line.startFen);
    if (!this.chess) {
      this.completeLine(true);
      return;
    }
    this.board.fen = line.startFen;
    this.board.lastMove = null;
    this.ply = 0;
    this.emit();
    this.playForward(true);
  }

  playForward(overlay) {
    if (this.promptAtCursor) {
      this.beginAwaiting();
      return;
    }
    this.phase = { kind: 'playingLine' };
    if (overlay) this.board.waiting = true;
    this.emit();
    const gen = this.gen;
    (async () => {
      await this.playToNextPrompt(gen);
      if (gen !== this.gen) return;
      this.board.waiting = false;
      if (!this.promptAtCursor) this.completeLine(this.hasMovesLeft);
      else this.beginAwaiting();
    })();
  }

  async playToNextPrompt(gen) {
    const line = this.line;
    if (!line) return;
    while (this.ply < line.movesUci.length && !this.promptAtCursor) {
      if (gen !== this.gen) return;
      if (!(await this.animateMove(line.movesUci[this.ply], gen))) return;
    }
  }

  async animateMove(uci, gen) {
    const m = playUci(this.chess, uci);
    if (!m) return false;
    this.ply += 1;
    this.board.fen = this.chess.fen();
    this.board.lastMove = [m.from, m.to];
    this.emit();
    await this.clock.sleep(this.animation);
    if (gen !== this.gen) return false;
    if (!this.promptAtCursor && this.hasMovesLeft) await this.clock.sleep(BOOK_GAP);
    return gen === this.gen;
  }

  beginAwaiting() {
    const p = this.promptAtCursor;
    if (!p) return;
    Object.assign(this, { prompt: p, attempts: 0, hintLevel: 0, usedHint: false, continuation: 'endDrill', lastReplySan: null });
    Object.assign(this.board, { waiting: false, arrows: [], marks: [], hint: [], policy: 'answering' });
    this.promptStartedAt = this.clock.now();
    this.phase = { kind: 'awaitingMove' };
    this.emit();
    this.playPremove();
  }

  completeLine(cutShort) {
    Object.assign(this.board, { waiting: false, hint: [], policy: 'readOnly' });
    this.premove = null;
    this.prompt = null;
    this.lastReplySan = null;
    this.continuation = this.lineIndex + 1 < this.plan.lines.length ? 'nextLine' : 'finish';
    this.phase = { kind: 'lineComplete', cutShort };
    this.emit();
  }

  // ---------------------------------------------------------------- answering

  /** A move from the board: {from, to, promotion?}. */
  handle(attempt) {
    if (this.acceptsPremove) {
      this.queuePremove(attempt.from, attempt.to);
      return;
    }
    const prompt = this.prompt;
    if (!this.awaitingInput || !prompt) return;
    const uci = attempt.from + attempt.to + (attempt.promotion || '');
    const probe = load(this.chess.fen());
    const legal = probe && playUci(probe, uci);
    if (!legal) {
      this.emit(); // snaps the piece back
      return;
    }
    const isLine = uci === prompt.answerUci || uciOf(legal) === prompt.answerUci;

    if (this.phase.kind === 'teachBack') {
      if (!isLine) {
        this.flash(attempt.from, 600);
        return;
      }
      const san = this.phase.san;
      this.applyAnswer(prompt.answerUci);
      this.record(false);
      this.grade({ kind: 'wrong' }, prompt, prompt.answerUci);
      this.phase = { kind: 'feedback', result: 'revealed', san };
      this.beginContinuation(true, attempt.drag);
      return;
    }

    if (isLine) {
      this.attempts += 1;
      const firstTry = this.attempts === 1 && !this.usedHint;
      const outcome = this.outcome(!!attempt.promotion);
      this.applyAnswer(prompt.answerUci);
      this.record(firstTry);
      this.grade(outcome, prompt, prompt.answerUci);
      this.phase = { kind: 'feedback', result: 'correct', san: prompt.answerSan };
      this.beginContinuation(false, attempt.drag);
      return;
    }

    const altIndex = prompt.altUci.indexOf(uciOf(legal));
    if (altIndex >= 0) {
      this.continuation = 'endDrill';
      this.phase = { kind: 'offLine', played: prompt.altSan[altIndex] || legal.san, lineMove: prompt.answerSan };
      this.flash(attempt.from, 600);
      return;
    }

    this.attempts += 1;
    this.continuation = 'endDrill';
    this.phase = { kind: 'feedback', result: 'wrong', played: legal.san, expected: prompt.answerSan, why: prompt.whyNot?.[legal.san] || null };
    this.flash(attempt.from, 800);
  }

  flash(square, ms) {
    const token = {};
    this.flashToken = token;
    this.board.flash = square;
    this.emit();
    this.clock.sleep(ms / 1000).then(() => {
      if (this.flashToken !== token) return;
      this.board.flash = null;
      this.emit();
    });
  }

  applyAnswer(uci) {
    const m = playUci(this.chess, uci);
    this.ply += 1;
    this.board.fen = this.chess.fen();
    this.board.lastMove = m ? [m.from, m.to] : null;
    this.board.hint = [];
    const note = this.prompt?.coach;
    if (note?.arrows?.length) this.board.arrows = note.arrows;
    if (note?.marks?.length) this.board.marks = note.marks;
    this.board.policy = this.hasPromptAhead ? 'premoving' : 'readOnly';
  }

  record(correct) {
    this.answered += 1;
    if (correct) {
      this.correct += 1;
      this.correctInLine += 1;
    }
  }

  outcome(promotion) {
    const elapsed = (this.clock.now() - (this.promptStartedAt || this.clock.now())) / 1000;
    if (this.usedHint) return { kind: 'hint' };
    if (this.attempts > 1) return { kind: 'retry', attempts: this.attempts - 1 };
    return { kind: 'first', elapsed, promotion };
  }

  advance() {
    if (this.phase.kind !== 'lineComplete') return;
    this.cancel();
    this.lineIndex += 1;
    if (this.lineIndex >= this.plan.lines.length) this.finish(true);
    else this.beginLine();
  }

  continueLine() {
    if (this.continuation !== 'nextMove' || this.phase.kind !== 'feedback') return;
    this.cancel();
    this.playForward(false);
  }

  /** The one primary button. */
  primary() {
    switch (this.continuation) {
      case 'nextMove':
        return this.continueLine();
      case 'nextLine':
      case 'finish':
        return this.advance();
      case 'done':
        return undefined;
      default:
        return this.finish(false);
    }
  }

  // ---------------------------------------------------------------- assistance

  hint() {
    const p = this.prompt;
    if (!this.acceptsHint || !p) return;
    this.usedHint = true;
    this.hints += 1;
    const from = p.answerUci.slice(0, 2);
    const to = p.answerUci.slice(2, 4);
    if (this.hintLevel === 0) {
      this.hintLevel = 1;
      this.board.hint = [from];
      this.emit();
      const gen = this.gen;
      this.clock.sleep(3).then(() => {
        if (gen === this.gen && this.hintLevel === 1 && this.board.hint[0] === from) {
          this.board.hint = [];
          this.emit();
        }
      });
    } else {
      this.hintLevel = 2;
      this.board.arrows = [{ from, to, style: 'primary' }];
      this.emit();
    }
  }

  reveal() {
    const p = this.prompt;
    const wrong = this.phase.kind === 'feedback' && this.phase.result === 'wrong';
    if (!(this.acceptsHint || wrong) || !p) return;
    this.cancel();
    this.usedHint = true;
    this.board.arrows = [{ from: p.answerUci.slice(0, 2), to: p.answerUci.slice(2, 4), style: 'primary' }];
    this.board.policy = 'answering';
    this.continuation = 'endDrill';
    this.phase = { kind: 'teachBack', san: p.answerSan };
    this.emit();
  }

  skip() {
    const p = this.prompt;
    if (!this.awaitingInput || !p) return;
    const probe = load(this.chess.fen());
    if (!probe || !playUci(probe, p.answerUci)) {
      this.completeLine(true);
      return;
    }
    this.applyAnswer(p.answerUci);
    this.record(false);
    this.phase = { kind: 'feedback', result: 'revealed', san: p.answerSan };
    this.beginContinuation(true, false);
  }

  // ---------------------------------------------------------------- premoves

  get premoveInvitable() {
    return this.board.policy === 'premoving' && this.acceptsPremove && this.hasPromptAhead;
  }

  queuePremove(from, to) {
    if (!this.premoveInvitable) return;
    if (from === to) {
      this.clearPremove();
      return;
    }
    const piece = this.chess.get(from);
    if (!piece || (piece.color === 'w' ? 'white' : 'black') !== this.board.orientation) return;
    this.premove = { from, to };
    this.board.hint = [from, to];
    this.emit();
  }

  clearPremove() {
    if (!this.premove) return;
    this.premove = null;
    this.board.hint = [];
    this.emit();
  }

  playPremove() {
    const pm = this.premove;
    if (!pm) return;
    this.premove = null;
    this.board.hint = [];
    const answer = this.promptAtCursor?.answerUci;
    const candidates = [];
    if (answer && answer.startsWith(pm.from + pm.to)) candidates.push(answer);
    candidates.push(pm.from + pm.to, `${pm.from + pm.to}q`);
    for (const c of candidates) {
      const probe = load(this.chess.fen());
      if (probe && playUci(probe, c)) {
        this.handle({ from: c.slice(0, 2), to: c.slice(2, 4), promotion: c[4] });
        return;
      }
    }
    this.emit();
  }

  // ---------------------------------------------------------------- carrying on

  beginContinuation(revealed, dragged) {
    this.continuation = !this.hasPromptAhead ? 'automatic' : this.manualPacing() ? 'nextMove' : 'automatic';
    this.emit();
    this.gen += 1;
    const gen = this.gen;
    (async () => {
      const flight = dragged ? 0 : this.animation;
      await this.clock.sleep((flight + READING_BEAT) * (revealed ? 1.8 : 1));
      if (gen !== this.gen) return;
      const line = this.line;
      if (line && this.hasMovesLeft && !this.promptAtCursor) {
        const probe = load(this.chess.fen());
        const m = probe && playUci(probe, line.movesUci[this.ply]);
        this.lastReplySan = m ? m.san : null;
        if (!(await this.animateMove(line.movesUci[this.ply], gen))) {
          if (gen !== this.gen) return;
          this.lastReplySan = null;
        }
        if (gen !== this.gen) return;
      }
      await this.playToNextPrompt(gen);
      if (gen !== this.gen) return;
      if (!this.promptAtCursor) {
        this.completeLine(this.hasMovesLeft);
        return;
      }
      if (this.continuation !== 'automatic') {
        this.emit();
        return;
      }
      this.beginAwaiting();
    })();
  }

  // ---------------------------------------------------------------- grading

  grade(outcome, prompt, played) {
    const g = prompt.grading;
    if (!g) return;
    const grade = gradeFor(outcome, g.phase);
    if (!grade || this.graded.has(g.card)) return;
    this.graded.add(g.card);
    this.commit({
      card: g.card,
      grade,
      elapsed: (this.clock.now() - (this.promptStartedAt || this.clock.now())) / 1000,
      played,
      at: this.clock.now(),
    });
  }

  summary(completed) {
    const studies = this.studyIds;
    const first = this.plan.lines[0];
    const spans = studies.size > 1;
    return {
      total: this.answered,
      correct: this.correct,
      hints: this.hints,
      elapsed: (this.clock.now() - this.startedAt) / 1000,
      linesPlayed: Math.min(this.lineIndex + 1, this.plan.lines.length),
      lineCount: this.plan.lines.length,
      title: spans ? 'Mixed drill' : first?.studyTitle || 'Drill',
      subtitle: spans ? `${studies.size} openings` : first ? `${first.side === 'white' ? 'White' : 'Black'} repertoire` : '',
      coverSeed: first?.coverSeed || 0,
      completed,
      accuracy: this.answered ? this.correct / this.answered : 0,
    };
  }
}
