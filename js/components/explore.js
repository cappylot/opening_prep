// Explore tab: what the opponent plays (or faces) in the current position.
import { useMemo } from '../../vendor/preact/hooks.module.js';
import { html, Icon, IconButton, ResultBar, Empty, pct, plural, shortDate, cap, scoreClass } from '../ui.js';
import { smoothScore, formatLine } from '../tree.js';
import { suggestLines } from '../insights.js';
import { gameUrl } from '../lichess.js';

export function ExplorePanel({ tree, node, ranked, oppTurn, oppName, oppColor, opening, shown, settings, onPlay, onLoadLine, onBackToBook, gameOver, partial, evalChip, evalLine, onSave }) {
  const minGames = settings.minGames;
  const ideas = useMemo(
    () => (node && node.n >= minGames ? suggestLines(tree, oppColor, { start: shown, maxPly: shown.length + 10, minN: minGames, limit: 3 }) : []),
    [tree, node, shown.join(','), minGames]
  );

  const reach = node?.reach || 0;
  const posScore = node ? smoothScore(node.rWin, node.rDraw, node.reachW) : 0.5;
  const rawPos = node && node.reachW ? (node.rWin + 0.5 * node.rDraw) / node.reachW : null;
  const best = !oppTurn ? ranked.filter((m) => m.n >= minGames).sort((a, b) => a.score - b.score)[0] : null;

  const header = html`<div class="pos-head">
    <div class="pos-title">
      <span class=${`turn-pill ${oppTurn ? 'opp' : 'me'}`}>${gameOver ? 'Game over' : oppTurn ? `${oppName} to move` : 'Your move'}</span>
      ${opening
        ? html`<span class="opening" title=${opening.name}><b>${opening.eco}</b> ${opening.name}</span>`
        : html`<span class="opening muted">${shown.length ? '' : 'Starting position'}</span>`}
      <span class="pos-tools">
        ${evalChip}
        ${onSave ? html`<${IconButton} icon="bookmark" label="Save this line" class="accent" onClick=${onSave} />` : ''}
      </span>
    </div>
    ${evalLine || ''}
    ${reach
      ? html`<div class="pos-stats">
          <span>${plural(reach, 'game')} here</span>
          <span class=${`score ${scoreClass(posScore, reach, minGames)}`}>they score ${pct(rawPos)}</span>
        </div>
        <${ResultBar} win=${node.reachW - node.rWin - node.rDraw} draw=${node.rDraw} loss=${node.rWin} />`
      : ''}
  </div>`;

  if (!node || !ranked.length) {
    return html`${header}
      <${Empty} icon="flag" title=${reach ? 'No moves recorded from here' : 'Out of their book'}>
        <p>
          ${reach
            ? `${oppName}'s games that reached this position ended here or went past move 15.`
            : `${oppName} has never reached this position in the games that match your filters. Anything you play from here is new to them.`}
        </p>
        ${shown.length ? html`<button class="btn" onClick=${onBackToBook}><${Icon} name="prev" size=${16} /> Back to their last known position</button>` : ''}
        ${partial ? html`<p class="hint">Only part of their history was downloaded. Re-download to include older games.</p>` : ''}
      </${Empty}>
      ${reach ? html`<${RecentGames} node=${node} oppColor=${oppColor} />` : ''}`;
  }

  return html`${header}
    <div class="move-table" role="table" aria-label=${oppTurn ? `${oppName}'s moves` : `Moves played against ${oppName}`}>
      <div class="mt-head" role="row">
        <span>${oppTurn ? 'Move' : 'You'}</span><span>Played</span><span class="num">Games</span><span>Results</span><span class="num">Score</span>
      </div>
      ${ranked.map((m, i) => {
        const low = m.n < minGames;
        const badges = [];
        if (oppTurn) {
          if (i === 0 && !low) badges.push(['likely', m.freq >= 0.5 ? 'Main line' : 'Most likely']);
          if (!low && m.score < 0.42) badges.push(['good', 'They struggle']);
          if (!low && m.score > 0.6) badges.push(['bad', 'Their strength']);
        } else {
          if (best && m.uci === best.uci && m.score < 0.5) badges.push(['good', 'Best try']);
          else if (!low && m.score < 0.42) badges.push(['good', 'Good for you']);
          if (!low && m.score > 0.6) badges.push(['bad', 'Avoid']);
        }
        if (low) badges.push(['muted', 'Few games']);
        return html`<button key=${m.uci} class=${`mt-row ${low ? 'low' : ''}`} role="row" onClick=${() => onPlay(m.uci)}>
          <span class="san">${m.san}</span>
          <span class="freq"><span class="freq-bar"><span style=${{ width: `${Math.max(2, m.freq * 100)}%` }} /></span><b>${pct(m.freq)}</b></span>
          <span class="num">${m.n}</span>
          <span class="res"><${ResultBar} compact win=${m.loss} draw=${m.draw} loss=${m.win} /></span>
          <span class=${`num score ${scoreClass(m.score, m.n, minGames)}`}>${pct(m.raw)}</span>
          ${badges.length ? html`<span class="badges">${badges.map(([k, t]) => html`<span class=${`badge ${k}`}>${t}</span>`)}</span>` : ''}
        </button>`;
      })}
      <div class="legend"><span class="sw w" />they lost <span class="sw d" />draw <span class="sw l" />they won
        ${settings.halfLife ? html` · recent games weigh more` : ''}</div>
    </div>

    ${ideas.length
      ? html`<section class="ideas">
          <h3><${Icon} name="bulb" size=${16} /> Prep ideas from here</h3>
          ${ideas.map((l) => html`<${LineCard} line=${l} startPly=${shown.length} onClick=${() => onLoadLine(l.path)} />`)}
        </section>`
      : ''}
    <${RecentGames} node=${node} oppColor=${oppColor} />`;
}

export function LineCard({ line, startPly = 0, onClick }) {
  const sans = line.sans.slice(startPly);
  return html`<button class="line-card" onClick=${onClick}>
    <span class="line-moves">${formatLine(sans, startPly)}</span>
    <span class="line-meta">
      <span>They follow this <b>${pct(line.prob)}</b></span>
      <span class=${`score ${scoreClass(line.score, line.n, 3)}`}>they score <b>${pct(line.raw)}</b></span>
      <span>${plural(line.n, 'game')}</span>
    </span>
  </button>`;
}

function RecentGames({ node, oppColor }) {
  if (!node?.games.length) return '';
  return html`<section class="recent-games">
    <h3>Their recent games from here</h3>
    <ul>
      ${node.games.slice(0, 6).map(({ g, ply }) => {
        const r = g.res === 1 ? ['bad', 'Won'] : g.res === 0 ? ['good', 'Lost'] : ['neutral', 'Draw'];
        return html`<li key=${g.id}>
          <a href=${gameUrl(g.id, ply, oppColor)} target="_blank" rel="noopener">
            <span class=${`res-chip ${r[0]}`}>${r[1]}</span>
            <span class="rg-main"><b>vs ${g.vs}</b>${g.vsRating ? html` <small>(${g.vsRating})</small>` : ''}
              <small class="rg-open">${g.opening?.name || ''}</small></span>
            <span class="rg-meta"><small>${cap(g.speed)}</small><small>${shortDate(g.t)}</small></span>
            <${Icon} name="external" size=${14} />
          </a>
        </li>`;
      })}
    </ul>
  </section>`;
}
