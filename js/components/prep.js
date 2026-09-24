// Prep screen: opponent header, board, and the Explore / Insights / Lines tabs.
import { useEffect, useMemo, useRef, useState, useCallback } from '../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, Segmented, toast, plural, ago, cap, shareOrCopy, vibrate, Empty } from '../ui.js';
import { Board, arrowsFor, destsOf } from '../board.js';
import { buildTree, fenKey, playPath, rankedMoves, openingAlong } from '../tree.js';
import { cloudEval, profileUrl } from '../lichess.js';
import { syncOpponent, touchOpponent } from '../data.js';
import { listLines } from '../store.js';
import { prepHash, go } from '../route.js';
import { ExplorePanel } from './explore.js';
import { InsightsPanel } from './insightsPanel.js';
import { LinesPanel, SaveLineSheet, DrillView } from './lines.js';
import { FilterSheet, filterSummary } from './filters.js';

const STALE_MS = 6 * 3600 * 1000;
const SPEED_ORDER = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];

export function PrepView({ route, settings, updateSettings, openSettings }) {
  const name = route.name;
  const [data, setData] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | downloading | ready | error
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ received: 0, expected: null, wait: 0 });
  const [syncing, setSyncing] = useState(false);
  const abortRef = useRef(null);

  const [myColor, setMyColor] = useState(route.color || 'white');
  const [path, setPath] = useState(route.moves);
  const [cursor, setCursor] = useState(route.moves.length);
  const [tab, setTab] = useState(route.tab);
  const [filters, setFilters] = useState({ speeds: [], ratedOnly: false, periodDays: 0 });
  const [sheet, setSheet] = useState(null); // 'filters' | 'save' | {edit: line}
  const [drill, setDrill] = useState(null);
  const [lines, setLines] = useState([]);
  const [resetKey, setResetKey] = useState(0);
  const [evalData, setEvalData] = useState(null);

  // ---- loading ----
  const download = useCallback(
    async (mode) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const hasData = mode !== 'full-initial';
      if (!hasData) {
        setPhase('downloading');
        setProgress({ received: 0, expected: null, wait: 0 });
      } else setSyncing(true);
      try {
        const r = await syncOpponent(name, {
          mode: mode === 'update' ? 'update' : 'full',
          config: { max: settings.maxGames, perfTypes: settings.perfTypes, period: settings.period },
          signal: ctrl.signal,
          onProgress: (p) => setProgress((x) => ({ ...x, ...p, wait: 0 })),
          onWait: (s) => setProgress((x) => ({ ...x, wait: s })),
        });
        setData(r);
        setPhase('ready');
        if (mode === 'update') toast(r.added ? `${plural(r.added, 'new game')} added` : 'Already up to date', 'ok');
        else if (mode === 'full') toast(`Downloaded ${plural(r.games.length, 'game')}`, 'ok');
        if (r.stopped) toast(`Stopped early: analysing ${plural(r.games.length, 'game')}`);
      } catch (e) {
        if (e.name === 'AbortError') {
          if (!hasData) go('#/');
          return;
        }
        if (!hasData) {
          setError(e);
          setPhase('error');
        } else toast(e.message, 'error');
      } finally {
        setSyncing(false);
      }
    },
    [name, settings.maxGames, settings.perfTypes, settings.period]
  );

  useEffect(() => {
    let live = true;
    (async () => {
      const cached = await syncOpponent(name, { mode: 'cache' });
      if (!live) return;
      if (cached) {
        setData(cached);
        setPhase('ready');
        touchOpponent(cached.opp);
        if (Date.now() - cached.opp.fetchedAt > STALE_MS && navigator.onLine !== false) download('update');
      } else download('full-initial');
    })();
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [name]);

  const oppId = data?.opp.id || name.toLowerCase();
  const reloadLines = () => listLines(oppId).then(setLines);
  useEffect(() => {
    reloadLines();
  }, [oppId]);

  // ---- derived state ----
  const oppColor = myColor === 'white' ? 'black' : 'white';
  const since = filters.periodDays ? Date.now() - filters.periodDays * 864e5 : null;
  const tree = useMemo(
    () => (data ? buildTree(data.games, { color: oppColor, speeds: filters.speeds, ratedOnly: filters.ratedOnly, since }, { halfLifeDays: settings.halfLife }) : null),
    [data, oppColor, filters, settings.halfLife]
  );
  const shown = path.slice(0, cursor);
  const shownKey = shown.join(',');
  const pos = useMemo(() => playPath(shown), [shownKey]);
  const chess = pos.chess;
  const fen = chess.fen();
  const node = tree?.nodes.get(fenKey(fen));
  const ranked = useMemo(() => rankedMoves(node), [node]);
  const turnColor = chess.turn() === 'w' ? 'white' : 'black';
  const oppTurn = turnColor === oppColor;
  const dests = useMemo(() => destsOf(chess), [fen]);
  const opening = useMemo(() => (tree ? openingAlong(tree, shown) : null), [tree, shownKey]);
  const moveList = chess.history({ verbose: true });
  const last = moveList[moveList.length - 1];
  const colorCounts = useMemo(() => {
    const c = { white: 0, black: 0 };
    for (const g of data?.games || []) c[g.oppColor]++;
    return c;
  }, [data]);
  const speeds = useMemo(() => {
    const m = new Map();
    for (const g of data?.games || []) if (g.oppColor === oppColor) m.set(g.speed, (m.get(g.speed) || 0) + 1);
    return [...m.entries()].sort((a, b) => SPEED_ORDER.indexOf(a[0]) - SPEED_ORDER.indexOf(b[0]));
  }, [data, oppColor]);

  // Keep the URL in sync so the page can be bookmarked or shared.
  useEffect(() => {
    const h = prepHash(data?.opp.name || name, { color: myColor, moves: shown, tab });
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [shownKey, myColor, tab, data]);

  // Cloud eval, debounced.
  useEffect(() => {
    setEvalData(null);
    if (!settings.showEval || chess.isGameOver()) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      cloudEval(fen, ctrl.signal)
        .then((e) => setEvalData(e === undefined ? null : { fen, ...(e || { none: true }) }))
        .catch(() => {});
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [fen, settings.showEval]);

  // Show the top of the panel whenever the position or tab changes.
  const panelRef = useRef(null);
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [shownKey, tab, myColor]);

  // ---- navigation ----
  const playUci = (uci) => {
    if (path[cursor] === uci) setCursor(cursor + 1);
    else {
      setPath([...shown, uci]);
      setCursor(cursor + 1);
    }
    if (settings.haptics) vibrate(8);
  };
  const onBoardMove = (orig, dest) => {
    const m = chess.moves({ verbose: true }).find((x) => x.from === orig && x.to === dest && (!x.promotion || x.promotion === 'q'));
    if (!m) return setResetKey((k) => k + 1);
    playUci(m.from + m.to + (m.promotion || ''));
  };
  const back = () => cursor > 0 && setCursor(cursor - 1);
  const forward = () => {
    if (cursor < path.length) setCursor(cursor + 1);
    else if (ranked[0]) playUci(ranked[0].uci);
  };
  const jump = (i) => setCursor(Math.max(0, Math.min(path.length, i)));
  const loadLine = (p) => {
    setPath(p);
    setCursor(p.length);
    setTab('explore');
  };
  const backToBook = () => {
    for (let i = cursor - 1; i >= 0; i--) {
      const n = tree.nodes.get(fenKey(playPath(shown.slice(0, i)).chess.fen()));
      if (n && n.moves.size) return setCursor(i);
    }
    setCursor(0);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (drill || sheet || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft') back();
      else if (e.key === 'ArrowRight') forward();
      else if (e.key === 'ArrowUp') jump(0);
      else if (e.key === 'ArrowDown') jump(path.length);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Horizontal swipes on the panel step through moves.
  const swipe = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || tab !== 'explore') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 40) dx < 0 ? forward() : back();
  };

  // ---- board decorations ----
  const shapes = useMemo(() => {
    const s = arrowsFor(ranked, { oppTurn, count: settings.arrows, minGames: settings.minGames });
    if (settings.evalArrow && evalData?.best && evalData.fen === fen) {
      const b = evalData.best;
      if (!s.some((x) => x.orig === b.slice(0, 2) && x.dest === b.slice(2, 4))) s.push({ orig: b.slice(0, 2), dest: b.slice(2, 4), brush: 'engine', modifiers: { lineWidth: 6 } });
    }
    return s;
  }, [ranked, oppTurn, settings.arrows, settings.minGames, settings.evalArrow, evalData, fen]);

  // ---- render ----
  const opp = data?.opp;
  const profile = opp?.profile;
  const ratings = profile
    ? SPEED_ORDER.filter((p) => profile.perfs[p]).map((p) => `${cap(p)} ${profile.perfs[p].rating}${profile.perfs[p].prov ? '?' : ''}`).slice(0, 3).join(' · ')
    : '';

  const header = html`<header class="topbar">
    <${IconButton} icon="back" label="Back to search" onClick=${() => go('#/')} />
    <div class="opp-card">
      <a class="opp-name" href=${profileUrl(opp?.name || name)} target="_blank" rel="noopener">
        ${profile?.title ? html`<span class="title-badge">${profile.title}</span>` : ''}${opp?.name || name}
      </a>
      <small>${opp ? html`${ratings || 'Unrated'}${profile?.tos ? html` · <span class="warn">ToS violation</span>` : ''}` : 'Loading…'}</small>
    </div>
    ${phase === 'ready'
      ? html`<${IconButton} icon="refresh" label="Fetch new games" spin=${syncing} disabled=${syncing} onClick=${() => download('update')} />
          <${IconButton} icon="share" label="Share this position" onClick=${() =>
            shareOrCopy({ title: `Prep vs ${opp.name}`, text: `Opening prep vs ${opp.name}`, url: location.href })} />`
      : ''}
    <${IconButton} icon="settings" label="Settings" onClick=${openSettings} />
  </header>`;

  if (phase !== 'ready') {
    return html`<main class="prep loading-view">
      ${header}
      <div class="center-wrap">
        ${phase === 'error'
          ? html`<${Empty} icon="alert" title=${error?.status === 404 ? 'Player not found' : 'Could not load games'}>
              <p>${error?.message}</p>
              <div class="row gap">
                <button class="btn" onClick=${() => go('#/')}>Back</button>
                ${error?.status !== 404 ? html`<button class="btn primary" onClick=${() => download('full-initial')}>Try again</button>` : ''}
              </div>
            </${Empty}>`
          : html`<${DownloadProgress} phase=${phase} progress=${progress} name=${name} onStop=${() => abortRef.current?.abort()} />`}
      </div>
    </main>`;
  }

  if (drill) {
    return html`<${DrillView} lines=${drill.lines} tree=${tree} myColor=${myColor} oppName=${opp.name} settings=${settings}
      onExit=${() => setDrill(null)} />`;
  }

  const colorOptions = [
    { value: 'white', label: html`<span class="piece-ico">♔</span> I'm White <small>${colorCounts.black}</small>` },
    { value: 'black', label: html`<span class="piece-ico">♚</span> I'm Black <small>${colorCounts.white}</small>` },
  ];
  const linesForColor = lines.filter((l) => l.color === myColor);
  const colorbar = (where) => html`
      <div class=${`colorbar ${where}`}>
        <${Segmented} options=${colorOptions} value=${myColor} onChange=${(c) => {
          setMyColor(c);
          setPath([]);
          setCursor(0);
        }} class="color-toggle" />
        <button class="chip filter-chip" onClick=${() => setSheet('filters')} aria-label="Filters">
          <${Icon} name="filter" size=${14} /> ${filterSummary(filters, settings)}
        </button>
      </div>`;

  return html`<main class="prep">
    ${header}
    <div class="prep-main">
      <section class="board-col">
        ${colorbar('portrait-only')}
        <${Board} fen=${fen} orientation=${myColor} turnColor=${turnColor} dests=${dests} lastMove=${last ? [last.from, last.to] : undefined}
          check=${chess.inCheck()} shapes=${shapes} onMove=${onBoardMove} coords=${settings.coords} resetKey=${resetKey} theme=${settings.board} />
        <div class="controls">
          <${IconButton} icon="first" label="Start position" onClick=${() => jump(0)} disabled=${cursor === 0} />
          <${IconButton} icon="prev" label="Previous move" onClick=${back} disabled=${cursor === 0} />
          <${MoveTrail} sans=${playPath(path).sans} cursor=${cursor} onJump=${jump} />
          <${IconButton} icon="next" label=${cursor < path.length ? 'Next move' : 'Play the most common move'} onClick=${forward}
            disabled=${cursor >= path.length && !ranked.length} />
          <${IconButton} icon="last" label="Last move" onClick=${() => jump(path.length)} disabled=${cursor >= path.length} />
        </div>
      </section>

      <section class="panel-col" onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
        ${colorbar('landscape-only')}
        <${Segmented} class="tabs" value=${tab} onChange=${setTab} options=${[
          { value: 'explore', label: 'Explore', icon: 'compass' },
          { value: 'insights', label: 'Insights', icon: 'chart' },
          { value: 'lines', label: `My lines${linesForColor.length ? ` (${linesForColor.length})` : ''}`, icon: 'bookmark' },
        ]} />
        <div class="panel-body" ref=${panelRef}>
          ${tab === 'explore'
            ? html`<${ExplorePanel} tree=${tree} node=${node} ranked=${ranked} oppTurn=${oppTurn} oppName=${opp.name} oppColor=${oppColor}
                opening=${opening} shown=${shown} settings=${settings} onPlay=${playUci} onLoadLine=${loadLine} onBackToBook=${backToBook}
                gameOver=${chess.isGameOver()} partial=${opp.partial}
                evalChip=${html`<${EvalChip} data=${evalData} fen=${fen} enabled=${settings.showEval} chess=${chess} />`}
                onSave=${cursor > 0 ? () => setSheet('save') : null} />`
            : tab === 'insights'
            ? html`<${InsightsPanel} tree=${tree} allGames=${data.games} oppColor=${oppColor} oppName=${opp.name} settings=${settings}
                onLoadLine=${loadLine} profile=${profile} opp=${opp} />`
            : html`<${LinesPanel} lines=${linesForColor} allCount=${lines.length} myColor=${myColor} oppName=${opp.name}
                onOpen=${(l) => loadLine(l.path)} onDrill=${(ls) => setDrill({ lines: ls })} onEdit=${(l) => setSheet({ edit: l })}
                onChanged=${reloadLines} onSaveCurrent=${cursor > 0 ? () => setSheet('save') : null} />`}
          <p class="data-note">
            ${plural(tree.games.length, 'game')} as ${oppColor} · updated ${ago(opp.fetchedAt)}${opp.partial ? ' · partial download' : ''}
            · <button class="link" onClick=${() => {
              if (confirm(`Download ${opp.name}'s games again using your current download options (${settings.maxGames} games)?`)) download('full');
            }}>re-download</button>
          </p>
        </div>
      </section>
    </div>

    <${FilterSheet} open=${sheet === 'filters'} onClose=${() => setSheet(null)} filters=${filters} setFilters=${setFilters}
      speeds=${speeds} settings=${settings} updateSettings=${updateSettings} />
    <${SaveLineSheet} open=${sheet === 'save' || !!sheet?.edit} onClose=${() => setSheet(null)} edit=${sheet?.edit}
      path=${sheet?.edit ? sheet.edit.path : shown} sans=${sheet?.edit ? sheet.edit.sans : pos.sans} opening=${opening}
      oppId=${opp.id} oppName=${opp.name} myColor=${sheet?.edit ? sheet.edit.color : myColor} onSaved=${() => (reloadLines(), setSheet(null))} />
  </main>`;
}

function DownloadProgress({ phase, progress, name, onStop }) {
  const { received, expected, wait } = progress;
  const ratio = expected ? Math.min(1, received / expected) : null;
  return html`<div class="card download">
    <div class="spinner-lg" aria-hidden="true">♞</div>
    <h2>${phase === 'loading' ? 'Opening…' : wait ? 'Lichess asked us to slow down' : `Downloading ${name}'s games`}</h2>
    ${wait
      ? html`<p>Retrying in ${wait} s. This happens when many requests are made in a short time.</p>`
      : phase === 'downloading'
      ? html`<p class="big-count">${received.toLocaleString()}${expected ? html`<small> / ~${expected.toLocaleString()}</small>` : ''}</p>`
      : ''}
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${ratio ? Math.round(ratio * 100) : undefined}>
      <span class=${ratio == null ? 'indeterminate' : ''} style=${ratio != null ? { width: `${ratio * 100}%` } : {}} />
    </div>
    ${phase === 'downloading' && received > 0
      ? html`<button class="btn" onClick=${onStop}><${Icon} name="stop" size=${16} /> Stop and analyze ${received} games</button>`
      : phase === 'downloading'
      ? html`<button class="btn ghost" onClick=${onStop}>Cancel</button>`
      : ''}
  </div>`;
}

function EvalChip({ data, fen, enabled, chess }) {
  if (!enabled) return html`<span class="eval-chip off" />`;
  if (chess.isCheckmate()) return html`<span class="eval-chip">Checkmate</span>`;
  if (chess.isDraw() || chess.isStalemate()) return html`<span class="eval-chip">Draw</span>`;
  if (!data || data.fen !== fen) return html`<span class="eval-chip loading" title="Cloud eval">···</span>`;
  if (data.none) return html`<span class="eval-chip muted" title="No cloud evaluation for this position">no eval</span>`;
  let text;
  let side;
  if (data.mate != null) {
    text = `#${data.mate}`;
    side = data.mate > 0 ? 'white' : 'black';
  } else {
    const v = data.cp / 100;
    text = `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    side = v > 0.3 ? 'white' : v < -0.3 ? 'black' : 'even';
  }
  let best = '';
  if (data.best) {
    try {
      const c = new chess.constructor(fen);
      best = c.move({ from: data.best.slice(0, 2), to: data.best.slice(2, 4), promotion: data.best[4] || 'q' }).san;
    } catch {
      /* ignore */
    }
  }
  return html`<span class=${`eval-chip ${side}`} title=${`Lichess cloud eval, depth ${data.depth}`}>
    <b>${text}</b>${best ? html`<small>${best}</small>` : ''}
  </span>`;
}

function MoveTrail({ sans, cursor, onJump }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current?.querySelector('.cur');
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    else if (ref.current) ref.current.scrollLeft = 0;
  }, [cursor, sans.length]);
  if (!sans.length) return html`<div class="trail empty-trail">Start position</div>`;
  return html`<div class="trail" ref=${ref}>
    <button class=${`trail-move start ${cursor === 0 ? 'cur' : ''}`} onClick=${() => onJump(0)} aria-label="Start">⌂</button>
    ${sans.map(
      (san, i) => html`${i % 2 === 0 ? html`<span class="trail-num">${i / 2 + 1}.</span>` : ''}<button
          class=${`trail-move ${i + 1 === cursor ? 'cur' : ''} ${i + 1 > cursor ? 'future' : ''}`} onClick=${() => onJump(i + 1)}>${san}</button>`
    )}
  </div>`;
}
