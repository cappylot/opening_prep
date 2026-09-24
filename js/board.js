// Chessground board wrapper plus helpers to turn tree stats into arrows.
import { Chessground } from '../vendor/chessground/chessground.min.js';
import { useEffect, useRef, useState } from '../vendor/preact/hooks.module.js';
import { html } from './ui.js';

const brush = (key, color, opacity, lineWidth = 10) => ({ key, color, opacity, lineWidth });

const BRUSHES = {
  green: brush('g', '#15781B', 1),
  red: brush('r', '#882020', 1),
  blue: brush('b', '#003088', 1),
  yellow: brush('y', '#e68f00', 1),
  opp0: brush('o0', '#2f7de1', 0.95),
  opp1: brush('o1', '#2f7de1', 0.75),
  opp2: brush('o2', '#2f7de1', 0.6),
  opp3: brush('o3', '#2f7de1', 0.5),
  opp4: brush('o4', '#2f7de1', 0.4),
  opp5: brush('o5', '#2f7de1', 0.35),
  good: brush('mg', '#1f9d55', 0.85),
  ok: brush('mo', '#d9a21b', 0.8),
  bad: brush('mb', '#e3342f', 0.8),
  thin: brush('mt', '#8a8f98', 0.5),
  engine: brush('en', '#a35ee8', 0.75, 7),
  hint: brush('hi', '#1f9d55', 0.9, 12),
};

/**
 * Arrows for the current position.
 * Opponent to move: blue arrows, thicker for more frequent replies, labelled with %.
 * Our move: coloured by how the opponent scored after that move.
 */
export function arrowsFor(ranked, { oppTurn, count = 4, minGames = 3 }) {
  const shapes = [];
  ranked.slice(0, count).forEach((m, i) => {
    const orig = m.uci.slice(0, 2);
    const dest = m.uci.slice(2, 4);
    const lineWidth = Math.round(5 + 13 * Math.min(1, m.freq));
    if (oppTurn) {
      shapes.push({
        orig,
        dest,
        brush: `opp${Math.min(i, 5)}`,
        modifiers: { lineWidth },
        label: m.freq >= 0.08 ? { text: String(Math.round(m.freq * 100)), fill: '#1b4f96' } : undefined,
      });
    } else {
      const b = m.n < minGames ? 'thin' : m.score < 0.42 ? 'good' : m.score > 0.58 ? 'bad' : 'ok';
      shapes.push({ orig, dest, brush: b, modifiers: { lineWidth: Math.max(6, lineWidth - 2) } });
    }
  });
  return shapes;
}

/** Legal destinations for chessground from a chess.js instance. */
export function destsOf(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

const PROMO = [
  ['q', 'queen'],
  ['r', 'rook'],
  ['b', 'bishop'],
  ['n', 'knight'],
];

/**
 * The chessground board.
 * Study extras: `pieces` / `theme` pick the iOS art, `animation` is seconds per move,
 * `highlights` maps squares to CSS classes (marks, hints, flashes), `movableColor`
 * with a different `turnColor` turns on premoves, `drawable` lets the user draw
 * arrows (onDraw gets the full shape list) and `askPromotion` shows a Q/R/B/N picker.
 */
export function Board({
  fen,
  orientation,
  turnColor,
  dests,
  lastMove,
  check,
  shapes,
  onMove,
  coords = true,
  viewOnly = false,
  resetKey = 0,
  theme = 'brown',
  pieces = 'cburnett',
  animation = 0.18,
  lastMoveHighlight = true,
  highlights,
  movableColor,
  onPremove,
  onSelect,
  drawable = false,
  userShapes,
  onDraw,
  askPromotion = false,
  decoration = '#c22e24',
}) {
  const el = useRef(null);
  const cg = useRef(null);
  const [promo, setPromo] = useState(null);
  const cb = useRef({});
  cb.current = { onMove, onPremove, onSelect, onDraw, askPromotion };

  const color = viewOnly ? undefined : movableColor || turnColor;
  const premove = !viewOnly && !!movableColor && movableColor !== turnColor;

  useEffect(() => {
    cg.current = Chessground(el.current, {
      fen,
      orientation,
      turnColor,
      coordinates: coords,
      autoCastle: true,
      animation: { enabled: animation > 0, duration: Math.round(animation * 1000) },
      highlight: { lastMove: lastMoveHighlight, check: true, custom: highlights },
      movable: {
        free: false,
        color,
        dests,
        showDests: true,
        rookCastle: false,
        events: {
          after: (o, d) => {
            const piece = cg.current?.state.pieces.get(d);
            const promotes = piece?.role === 'pawn' && (d[1] === '8' || d[1] === '1');
            if (promotes && cb.current.askPromotion) setPromo({ orig: o, dest: d, color: piece.color });
            else cb.current.onMove?.(o, d, promotes ? 'q' : undefined);
          },
        },
      },
      premovable: {
        enabled: premove,
        showDests: true,
        events: { set: (o, d) => cb.current.onPremove?.(o, d), unset: () => cb.current.onPremove?.(null, null) },
      },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      events: { select: (key) => cb.current.onSelect?.(key) },
      drawable: {
        enabled: true,
        visible: true,
        brushes: { ...BRUSHES, deco: brush('dc', decoration, 0.9, 11) },
        eraseOnClick: !drawable,
        shapes: userShapes || [],
        onChange: (sh) => cb.current.onDraw?.(sh),
      },
    });
    return () => cg.current?.destroy();
  }, []);

  useEffect(() => {
    cg.current?.set({
      fen,
      orientation,
      turnColor,
      lastMove,
      check,
      coordinates: coords,
      animation: { enabled: animation > 0, duration: Math.round(animation * 1000) },
      highlight: { lastMove: lastMoveHighlight, check: true, custom: highlights },
      movable: { color, dests: viewOnly ? new Map() : dests },
      premovable: { enabled: premove },
    });
    if (!premove) cg.current?.cancelPremove();
    setPromo(null);
  }, [fen, orientation, turnColor, lastMove && lastMove.join(), check, coords, viewOnly, resetKey, dests, color, premove, animation, lastMoveHighlight]);

  useEffect(() => {
    cg.current?.set({ highlight: { lastMove: lastMoveHighlight, check: true, custom: highlights } });
  }, [highlights && [...highlights].join()]);

  // redrawAll rebuilds the DOM, so only when something it draws actually changed.
  const drawn = useRef(`${coords}|${pieces}|${theme}`);
  useEffect(() => {
    const key = `${coords}|${pieces}|${theme}`;
    if (drawn.current === key) return;
    drawn.current = key;
    cg.current?.redrawAll();
  }, [coords, pieces, theme]);

  useEffect(() => {
    const st = cg.current?.state;
    if (!st) return;
    st.drawable.brushes.deco = brush('dc', decoration, 0.9, 11);
    st.drawable.eraseOnClick = !drawable;
    cg.current.setAutoShapes(st.drawable.autoShapes.slice());
  }, [decoration, drawable]);

  useEffect(() => {
    if (userShapes) cg.current?.setShapes(userShapes);
  }, [userShapes && JSON.stringify(userShapes), fen, resetKey]);

  useEffect(() => {
    cg.current?.setAutoShapes(shapes || []);
  }, [shapes && JSON.stringify(shapes), fen, resetKey]);

  const pick = (role) => {
    const p = promo;
    setPromo(null);
    if (role) cb.current.onMove?.(p.orig, p.dest, role);
    else cg.current?.set({ fen });
  };

  return html`<div class=${`board-wrap board-${theme} pieces-${pieces}`} style=${{ '--deco': decoration }}>
    <div ref=${el} class="cg-wrap"></div>
    ${promo &&
    html`<div class="promo" role="dialog" aria-label="Promote to">
      <div class="promo-box">
        ${PROMO.map(
          ([r, role]) => html`<button type="button" class="promo-btn cg-wrap" aria-label=${role} onClick=${() => pick(r)}>
            <piece class=${`${role} ${promo.color}`}></piece>
          </button>`
        )}
        <button type="button" class="promo-cancel" onClick=${() => pick(null)}>Cancel</button>
      </div>
    </div>`}
  </div>`;
}
