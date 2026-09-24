// PGN with variations, in and out (port of PGNDocument, PGNLexer, SANSuffix,
// PGNTreeParser, PGNAnnotationCommands and PGNWriter).
import { START_FEN, load, playSan, uciOf } from './chess.js';
import {
  createTree,
  insertChild,
  nodeOf,
  rootOf,
  childrenOf,
  emptyNote,
  mergeArrows,
  mergeMarks,
  sideToMoveAfter,
  POLICY,
} from './movetree.js';

// ---------------------------------------------------------------- document

/** Splits a PGN document into games: [{tags, tagOrder, movetext, startLine}]. */
export function splitGames(pgn) {
  const text = pgn.replace(/\r\n?/g, '\n').replace(/﻿/g, '');
  const games = [];
  let tags = {};
  let tagOrder = [];
  let lines = [];
  let startLine = 1;
  let sawMovetext = false;
  const flush = () => {
    const movetext = lines.join('\n');
    if (!tagOrder.length && !movetext.trim()) return;
    games.push({ tags, tagOrder, movetext, startLine });
    tags = {};
    tagOrder = [];
    lines = [];
    sawMovetext = false;
  };
  text.split('\n').forEach((raw, i) => {
    const trimmed = raw.trim();
    const pair = trimmed.startsWith('[') ? parseTagPair(trimmed) : null;
    if (pair) {
      if (sawMovetext) {
        flush();
        startLine = i + 1;
      }
      if (!(pair.name in tags)) tagOrder.push(pair.name);
      tags[pair.name] = pair.value;
      return;
    }
    if (trimmed) {
      if (!sawMovetext && !lines.length) startLine = Math.min(startLine, i + 1);
      sawMovetext = true;
    }
    lines.push(raw);
  });
  flush();
  return games;
}

/** `[Name "Value"]`, honouring \" and \\ escapes. */
export function parseTagPair(line) {
  const m = line.match(/^\[\s*([^\s"]+)\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return { name: m[1], value: m[2].replace(/\\(.)/g, '$1') };
}

// ---------------------------------------------------------------- lexer

const RESULTS = ['1/2-1/2', '1-0', '0-1', '*'];
const NULL_MOVES = ['--', 'Z0', '0000'];
const isWs = (c) => /\s/.test(c);
const isDelim = (c) => isWs(c) || '(){};$[]'.includes(c);
const isDigit = (c) => c >= '0' && c <= '9';
const flowed = (t) => t.split(/\s+/).filter(Boolean).join(' ');

export function tokenize(movetext) {
  const s = movetext;
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const here = () => ({ line, column: col });
  const adv = (n = 1) => {
    for (let k = 0; k < n && i < s.length; k++) {
      if (s[i] === '\n') {
        line += 1;
        col = 1;
      } else col += 1;
      i += 1;
    }
  };
  const push = (kind, value, pos, extra) => tokens.push({ kind, value, pos, ...extra });

  while (i < s.length) {
    const c = s[i];
    if (isWs(c)) {
      adv();
      continue;
    }
    if (c === '%' && col === 1) {
      while (i < s.length && s[i] !== '\n') adv();
      continue;
    }
    if (c === '{') {
      const start = here();
      adv();
      let text = '';
      while (i < s.length && s[i] !== '}') {
        text += s[i];
        adv();
      }
      if (i >= s.length) throw new PgnError(`A comment opened at line ${start.line}, column ${start.column} was never closed.`);
      adv();
      push('comment', flowed(text), start);
      continue;
    }
    if (c === ';') {
      const start = here();
      adv();
      let text = '';
      while (i < s.length && s[i] !== '\n') {
        text += s[i];
        adv();
      }
      push('comment', flowed(text), start);
      continue;
    }
    if (c === '(') {
      push('begin', null, here());
      adv();
      continue;
    }
    if (c === ')') {
      push('end', null, here());
      adv();
      continue;
    }
    if (c === '$') {
      const start = here();
      adv();
      let d = '';
      while (i < s.length && isDigit(s[i])) {
        d += s[i];
        adv();
      }
      push('nag', Number(d) || 0, start);
      continue;
    }
    const marker = RESULTS.find((r) => s.startsWith(r, i));
    if (marker) {
      const start = here();
      adv(marker.length);
      push('result', marker, start);
      continue;
    }
    if (isDigit(c) && startsMoveNumber(s, i)) {
      const start = here();
      let d = '';
      while (i < s.length && isDigit(s[i])) {
        d += s[i];
        adv();
      }
      push('number', Number(d), start);
      while (i < s.length && s[i] === '.') adv();
      continue;
    }
    if (c === '.') {
      while (i < s.length && s[i] === '.') adv();
      continue;
    }
    const start = here();
    let sym = '';
    while (i < s.length && !isDelim(s[i])) {
      sym += s[i];
      adv();
    }
    if (!sym) {
      adv();
      continue;
    }
    if (NULL_MOVES.includes(sym)) {
      push('null', null, start);
      continue;
    }
    const split = splitSuffix(sym);
    push('san', split.san, start, { nags: split.nags });
  }
  return tokens;
}

function startsMoveNumber(s, i) {
  let p = i;
  while (p < s.length && isDigit(s[p])) p += 1;
  if (p >= s.length) return true;
  return s[p] === '.' || isDelim(s[p]);
}

const SUFFIX_NAGS = [
  ['!!', 3],
  ['??', 4],
  ['!?', 5],
  ['?!', 6],
  ['!', 1],
  ['?', 2],
];
const FIGURINES = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': 'P', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': 'P' };

export function splitSuffix(token) {
  let san = normalizeSan(token);
  const nags = [];
  let stripped = true;
  while (stripped && san) {
    stripped = false;
    for (const [suf, nag] of SUFFIX_NAGS) {
      if (san.endsWith(suf)) {
        san = san.slice(0, -suf.length);
        nags.push(nag);
        stripped = true;
        break;
      }
    }
  }
  return { san: san.trim(), nags: nags.reverse() };
}

function normalizeSan(token) {
  let r = '';
  for (const ch of token) {
    if ('–—−'.includes(ch)) r += '-';
    else if (ch === ' ' || ch === ' ') continue;
    else r += FIGURINES[ch] || ch;
  }
  r = r.trim();
  for (const marker of ['e.p.', 'ep.']) {
    if (r.toLowerCase().endsWith(marker)) {
      r = r.slice(0, -marker.length).trim();
      break;
    }
  }
  return r;
}

export class PgnError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

// ---------------------------------------------------------------- annotations

const LETTER_STYLE = { B: 'primary', Y: 'secondary', G: 'tertiary', R: 'annotation' };
const STYLE_LETTER = { primary: 'B', secondary: 'Y', tertiary: 'G', annotation: 'R' };
export const styleOfLetter = (l) => LETTER_STYLE[String(l).toUpperCase()] || 'annotation';
export const letterOfStyle = (s) => STYLE_LETTER[s] || 'R';
const isSquare = (s) => /^[a-h][1-8]$/.test(s);

/** Pulls [%cal] and [%csl] out of a comment: {arrows, marks, text|null}. */
export function extractCommands(comment) {
  let arrows = [];
  let marks = [];
  const prose = comment.replace(/\[(%cal|%csl)([^\]]*)\]/gi, (_, kw, body) => {
    const entries = body
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const hasColour = entry.length === 3 || entry.length === 5;
      const style = hasColour ? styleOfLetter(entry[0]) : null;
      const coords = (hasColour ? entry.slice(1) : entry).toLowerCase();
      if (kw.toLowerCase() === '%cal') {
        if (coords.length !== 4) continue;
        const from = coords.slice(0, 2);
        const to = coords.slice(2);
        if (!isSquare(from) || !isSquare(to) || from === to) continue;
        arrows = mergeArrows(arrows, [{ from, to, style: style || 'annotation' }]);
      } else {
        if (!isSquare(coords)) continue;
        marks = mergeMarks(marks, [{ square: coords, style: style || 'tertiary' }]);
      }
    }
    return ' ';
  });
  const text = flowed(prose);
  return { arrows, marks, text: text || null };
}

export function encodeCommands(arrows = [], marks = []) {
  const parts = [];
  if (arrows.length) parts.push(`[%cal ${arrows.map((a) => letterOfStyle(a.style) + a.from + a.to).join(',')}]`);
  if (marks.length) parts.push(`[%csl ${marks.map((m) => letterOfStyle(m.style) + m.square).join(',')}]`);
  return parts.length ? parts.join(' ') : null;
}

// ---------------------------------------------------------------- parser

/**
 * Parses PGN into chapters: [{tags, tagOrder, startFen, tree, result, preamble,
 * title, side, diagnostics}]. A bad token inside a variation kills only that
 * variation; one on the mainline truncates the chapter there.
 * Throws PgnError when nothing usable is found.
 */
export function parsePgn(pgn, { maxDepthPly = 80 } = {}) {
  const raws = splitGames(pgn);
  if (!raws.length) throw new PgnError("That text doesn't contain any chess moves.");
  const chapters = [];
  const fatal = [];
  raws.forEach((raw, index) => {
    try {
      const ch = parseGame(raw, index, maxDepthPly);
      if (ch.tree.nodes.size > 1 || ch.tagOrder.length) chapters.push(ch);
    } catch (e) {
      fatal.push({ severity: 'error', message: e.message || `Game ${index + 1} could not be read.`, gameIndex: index });
    }
  });
  if (!chapters.length) {
    throw new PgnError(fatal[0]?.message || "That text doesn't contain any chess moves.", fatal);
  }
  chapters[0].diagnostics.push(...fatal);
  return chapters;
}

function parseGame(raw, gameIndex, maxDepthPly) {
  const diagnostics = [];
  const startFen = raw.tags.FEN || START_FEN;
  if (!load(startFen)) throw new PgnError(`Game ${gameIndex + 1} declares a starting position that isn't valid FEN: ${startFen}`);
  const tree = createTree(startFen);
  const tokens = tokenize(raw.movetext);
  // Each frame: the node the cursor stands on, and the node before the last move.
  const stack = [{ node: tree.rootId, prev: null }];
  let result = null;
  let preamble = null;
  let i = 0;
  const top = () => stack[stack.length - 1];
  const skipVariation = (from) => {
    let depth = 1;
    for (let k = from; k < tokens.length; k++) {
      if (tokens[k].kind === 'begin') depth += 1;
      else if (tokens[k].kind === 'end' && --depth === 0) return k + 1;
    }
    return tokens.length;
  };
  const bail = () => {
    if (stack.length > 1) {
      i = skipVariation(i);
      stack.pop();
    } else i = tokens.length;
  };

  while (i < tokens.length) {
    const t = tokens[i];
    switch (t.kind) {
      case 'number':
        i += 1;
        break;
      case 'result':
        result = t.value;
        i += 1;
        break;
      case 'comment': {
        if (!t.value) {
          i += 1;
          break;
        }
        const frame = top();
        const node = nodeOf(tree, frame.node);
        const ann = extractCommands(t.value);
        if (ann.arrows.length || ann.marks.length) {
          const note = node.coach || emptyNote();
          note.arrows = mergeArrows(note.arrows, ann.arrows);
          note.marks = mergeMarks(note.marks, ann.marks);
          node.coach = note;
        }
        if (ann.text) {
          if (frame.node === tree.rootId && stack.length === 1) {
            preamble = preamble ? `${preamble}\n\n${ann.text}` : ann.text;
          } else {
            node.comment = node.comment ? `${node.comment} ${ann.text}` : ann.text;
          }
        }
        i += 1;
        break;
      }
      case 'nag': {
        const frame = top();
        if (frame.node !== tree.rootId) nodeOf(tree, frame.node).nags.push(t.value);
        i += 1;
        break;
      }
      case 'begin': {
        const frame = top();
        const node = nodeOf(tree, frame.node);
        // A variation replaces the move just played, so it branches from its parent.
        stack.push({ node: frame.prev != null && node.parent != null ? node.parent : frame.node, prev: null });
        i += 1;
        break;
      }
      case 'end':
        if (stack.length > 1) stack.pop();
        else diagnostics.push(diag('warning', "Found a stray ')' with no matching '('. It was ignored.", t, gameIndex));
        i += 1;
        break;
      case 'null':
        diagnostics.push(
          diag('warning', `Null moves aren't supported. ${stack.length > 1 ? 'This variation was skipped.' : 'The line stops here.'}`, t, gameIndex),
        );
        bail();
        break;
      case 'san': {
        const frame = top();
        const node = nodeOf(tree, frame.node);
        if (node.ply >= maxDepthPly) {
          bail();
          break;
        }
        const chess = load(node.fen);
        const m = chess && playSan(chess, t.value);
        const childId = m ? insertChild(tree, frame.node, uciOf(m)) : null;
        if (!childId) {
          const inVar = stack.length > 1;
          diagnostics.push(
            diag(
              inVar ? 'warning' : 'error',
              `At move ${Math.floor(node.ply / 2) + 1} (line ${t.pos.line}, column ${t.pos.column}): “${t.value}” isn't a legal move in that position. The rest of this ${inVar ? 'variation' : 'chapter'} was skipped.`,
              t,
              gameIndex,
            ),
          );
          bail();
          break;
        }
        if (t.nags?.length) nodeOf(tree, childId).nags.push(...t.nags);
        stack[stack.length - 1] = { node: childId, prev: frame.node };
        i += 1;
        break;
      }
      default:
        i += 1;
    }
  }

  return {
    tags: raw.tags,
    tagOrder: raw.tagOrder,
    startFen,
    tree,
    result: result || raw.tags.Result || null,
    preamble,
    title: suggestedTitle(raw.tags),
    side: inferSide(tree),
    diagnostics,
  };
}

const diag = (severity, message, token, gameIndex) => ({ severity, message, pos: token.pos, gameIndex });

function suggestedTitle(tags) {
  for (const k of ['Event', 'Opening', 'White', 'StudyName', 'ChapterName']) {
    const v = tags[k]?.trim();
    if (v && v !== '?') return v;
  }
  return 'Imported chapter';
}

/** The side with the lower average branching factor is almost always the author's. */
export function inferSide(tree) {
  const totals = { white: [0, 0], black: [0, 0] };
  for (const node of tree.nodes.values()) {
    if (!node.children.length) continue;
    const t = totals[sideToMoveAfter(node)];
    t[0] += node.children.length;
    t[1] += 1;
  }
  if (!totals.white[1] || !totals.black[1]) return null;
  const w = totals.white[0] / totals.white[1];
  const b = totals.black[0] / totals.black[1];
  if (Math.abs(w - b) <= 0.05) return null;
  return w < b ? 'white' : 'black';
}

/**
 * Study metadata from the first chapter's tags, with filename fallbacks, as the
 * bundled seeder reads it.
 */
export function studyMetaFromChapters(chapters, fallbackName = 'study') {
  const tags = chapters[0]?.tags || {};
  const tag = (...names) => {
    for (const n of names) {
      const v = tags[n]?.trim();
      if (v && v !== '?') return v;
    }
    return null;
  };
  const sideTag = tag('StudySide', 'Orientation')?.toLowerCase();
  const side = sideTag === 'white' || sideTag === 'black' ? sideTag : chapters[0]?.side || 'white';
  return {
    slug: tag('StudySlug') || fallbackName,
    title: tag('StudyTitle') || fallbackName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    summary: tag('StudySummary'),
    eco: tag('StudyECO', 'ECO'),
    side,
  };
}

// ---------------------------------------------------------------- writer

const escapeTag = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sanitised = (t) => {
  const r = String(t || '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .trim();
  return r || null;
};

function commentFor(coach, prose) {
  const commands = encodeCommands(coach?.arrows, coach?.marks);
  const idea = coach?.idea ? sanitised(`Idea: ${coach.idea}`) : null;
  const parts = [commands, sanitised(prose), idea].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

const braced = (c) => {
  const w = c.split(/\s+/).filter(Boolean);
  if (!w.length) return [];
  w[0] = `{${w[0]}`;
  w[w.length - 1] += '}';
  return w;
};

const parenthesised = (tokens) => {
  if (!tokens.length) return [];
  const t = tokens.slice();
  t[0] = `(${t[0]}`;
  t[t.length - 1] += ')';
  return t;
};

function wrap(tokens, width = 80) {
  const lines = [];
  let line = '';
  for (const t of tokens) {
    if (!line) line = t;
    else if (line.length + 1 + t.length <= width) line += ` ${t}`;
    else {
      lines.push(line);
      line = t;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function movetextOf(tree, { preamble = null, result = '*' } = {}) {
  const root = rootOf(tree);
  const fields = tree.rootFen.split(' ');
  const first = Number(fields[5]) || 1;
  const offset = root.side === 'white' ? 0 : 1;
  const number = (ply) => first + Math.floor(Math.max(0, ply - 1 + offset) / 2);

  const moveTokens = (node, st) => {
    const out = [];
    if (node.side === 'white') out.push(`${number(node.ply)}.`);
    else if (st.needBlack) out.push(`${number(node.ply)}...`);
    st.needBlack = false;
    out.push(node.san || node.uci || '--');
    for (const g of node.nags) out.push(`$${g}`);
    const c = commentFor(node.coach, node.comment);
    if (c) {
      out.push(...braced(c));
      st.needBlack = true;
    }
    return out;
  };

  const continuation = (parentId, st) => {
    const out = [];
    let pid = parentId;
    while (true) {
      const kids = childrenOf(tree, pid);
      if (!kids.length) break;
      out.push(...moveTokens(kids[0], st));
      for (const sib of kids.slice(1)) {
        const inner = { needBlack: true };
        const tokens = [...moveTokens(sib, inner), ...continuation(sib.id, inner)];
        out.push(...parenthesised(tokens));
        st.needBlack = true;
      }
      pid = kids[0].id;
    }
    return out;
  };

  const tokens = [];
  const opening = commentFor(root.coach, preamble);
  if (opening) tokens.push(...braced(opening));
  tokens.push(...continuation(tree.rootId, { needBlack: true }), result);
  return wrap(tokens);
}

export function gamePgn(tree, { event, preamble = null, result = '*', extraTags = [] }) {
  const tags = [
    ['Event', event],
    ['Site', '?'],
    ['Date', '????.??.??'],
    ['Round', '?'],
    ['White', '?'],
    ['Black', '?'],
    ['Result', result],
  ];
  if (tree.rootFen !== START_FEN) tags.push(['SetUp', '1'], ['FEN', tree.rootFen]);
  tags.push(...extraTags);
  const header = tags.map(([k, v]) => `[${k} "${escapeTag(v)}"]`).join('\n');
  return `${header}\n\n${movetextOf(tree, { preamble, result })}`;
}

/** A whole study: one [Event] block per chapter, study tags on the first. */
export function studyPgn({ slug, title, summary, eco, side }, chapters) {
  const studyTags = [
    ['StudySlug', slug],
    ['StudyTitle', title],
    ['StudySummary', summary],
    ['StudySide', side],
    ['StudyECO', eco],
  ].filter(([, v]) => v != null && v !== '');
  return chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((ch, i) =>
      gamePgn(ch.tree, { event: ch.title || title, preamble: ch.preamble, extraTags: i === 0 ? studyTags : [] }),
    )
    .join('\n\n');
}

export { POLICY };
