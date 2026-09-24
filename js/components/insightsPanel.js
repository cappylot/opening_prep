// Insights tab: repertoire overview, weak spots and suggested prep lines.
import { useMemo } from '../../vendor/preact/hooks.module.js';
import { html, Icon, ResultBar, Empty, pct, plural, cap, scoreClass, shortDate } from '../ui.js';
import { summary, predictability, firstMoves, suggestLines, spots, headToHead } from '../insights.js';
import { formatLine } from '../tree.js';
import { LineCard } from './explore.js';
import { gameUrl } from '../lichess.js';

export function InsightsPanel({ tree, allGames, oppColor, oppName, settings, onLoadLine, profile }) {
  const minN = Math.max(3, settings.minGames);
  const data = useMemo(() => {
    if (!tree.games.length) return null;
    return {
      sum: summary(tree),
      pred: predictability(tree, oppColor),
      first: firstMoves(tree, oppColor),
      lines: suggestLines(tree, oppColor, { minN, limit: 5 }),
      spots: spots(tree, { minN: Math.max(4, minN), limit: 6 }),
    };
  }, [tree, oppColor, minN]);
  const h2h = useMemo(() => headToHead(allGames, settings.me), [allGames, settings.me]);

  if (!data) {
    return html`<${Empty} icon="filter" title="No games match">
      <p>${oppName} has no ${oppColor} games with the current filters. Try widening them.</p>
    </${Empty}>`;
  }
  const { sum, pred, first, lines, spots: sp } = data;
  const asColor = cap(oppColor);

  return html`<div class="insights">
    <section class="card stat-card">
      <h3>${oppName} as ${asColor}</h3>
      <div class="stat-row">
        <div class="stat"><b>${sum.n.toLocaleString()}</b><small>games</small></div>
        <div class="stat"><b>${pct(sum.score)}</b><small>score</small></div>
        <div class="stat"><b>${pred == null ? '–' : pct(pred)}</b><small>predictable</small></div>
      </div>
      <${ResultBar} win=${sum.loss} draw=${sum.draw} loss=${sum.win} />
      <p class="hint">
        ${pred == null
          ? ''
          : pred > 0.75
          ? `Very predictable: they usually play the same main line. Deep prep will pay off.`
          : pred > 0.5
          ? `Fairly consistent, with a main line and a few sidelines.`
          : `They vary their openings a lot. Prepare ideas more than long forced lines.`}
      </p>
    </section>

    <section class="card">
      <h3><${Icon} name="compass" size=${16} /> ${oppColor === 'white' ? 'Their first moves' : 'How they answer your first move'}</h3>
      ${first.slice(0, 5).map(
        (f) => html`<div class="first-row">
          ${f.san
            ? html`<button class="first-san" onClick=${() => onLoadLine([f.uci])}>1. ${f.san}<small>${plural(f.n, 'game')}</small></button>`
            : ''}
          <div class="reply-chips">
            ${f.replies.slice(0, 4).map(
              (r) => html`<button class=${`reply-chip ${scoreClass(r.score, r.n, minN)}`} onClick=${() => onLoadLine(f.uci ? [f.uci, r.uci] : [r.uci])}>
                <b>${f.san ? '' : '1. '}${r.san}</b> ${pct(r.freq)}
              </button>`
            )}
          </div>
        </div>`
      )}
    </section>

    <section class="card">
      <h3><${Icon} name="bulb" size=${16} /> Suggested prep lines</h3>
      <p class="hint">Follows their most likely replies and picks, at each of your turns, the move they've scored worst against.</p>
      ${lines.length
        ? lines.map((l) => html`<${LineCard} line=${l} onClick=${() => onLoadLine(l.path)} />`)
        : html`<p class="muted">Not enough games to suggest lines yet. Try lowering "minimum games" in Settings.</p>`}
    </section>

    ${sp.weak.length || sp.strong.length
      ? html`<section class="card">
          <h3><${Icon} name="target" size=${16} /> Where they struggle</h3>
          ${sp.weak.length ? sp.weak.map((s) => html`<${SpotRow} spot=${s} onClick=${() => onLoadLine(s.path)} />`) : html`<p class="muted">No clear weak spots.</p>`}
          ${sp.strong.length
            ? html`<h3 class="sub"><${Icon} name="alert" size=${16} /> Their comfort zones (avoid)</h3>
                ${sp.strong.map((s) => html`<${SpotRow} spot=${s} onClick=${() => onLoadLine(s.path)} />`)}`
            : ''}
        </section>`
      : ''}

    <section class="card">
      <h3><${Icon} name="list" size=${16} /> Openings as ${asColor}</h3>
      <div class="open-table">
        ${sum.openings.slice(0, 10).map(
          (o) => html`<div class="open-row">
            <span class="open-name"><b>${o.name}</b>${o.topVariation ? html`<small>${o.topVariation}</small>` : ''}</span>
            <span class="open-share"><span class="freq-bar"><span style=${{ width: `${o.share * 100}%` }} /></span>${pct(o.share)}</span>
            <span class=${`num score ${scoreClass(o.score, o.n, minN)}`}>${pct(o.score)}<small>${o.n}</small></span>
          </div>`
        )}
      </div>
    </section>

    ${h2h
      ? html`<section class="card">
          <h3>Head to head with ${settings.me}</h3>
          ${h2h.n
            ? html`<p>You: <b>${h2h.win}</b> won · <b>${h2h.draw}</b> drawn · <b>${h2h.loss}</b> lost</p>
                <ul class="h2h">${h2h.games.slice(0, 5).map(
                  (g) => html`<li><a href=${gameUrl(g.id, 0)} target="_blank" rel="noopener">${shortDate(g.t)} · ${cap(g.speed)} · ${g.opening?.name || ''}</a></li>`
                )}</ul>`
            : html`<p class="muted">No games between you in the downloaded history.</p>`}
        </section>`
      : ''}

    ${profile
      ? html`<section class="card">
          <h3>Profile</h3>
          <div class="perf-grid">
            ${Object.entries(profile.perfs)
              .filter(([k]) => ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'].includes(k))
              .map(([k, v]) => html`<div class="perf"><small>${cap(k)}</small><b>${v.rating}${v.prov ? '?' : ''}</b><small>${plural(v.games, 'game')}</small></div>`)}
          </div>
          ${profile.seenAt ? html`<p class="hint">Last seen ${shortDate(profile.seenAt)} · member since ${shortDate(profile.createdAt)}</p>` : ''}
        </section>`
      : ''}
  </div>`;
}

function SpotRow({ spot, onClick }) {
  return html`<button class="spot-row" onClick=${onClick}>
    <span class="line-moves">${formatLine(spot.sans)}</span>
    <span class=${`score ${scoreClass(spot.score, spot.n, 1)}`}>${pct(spot.raw)}<small>${plural(spot.n, 'game')}</small></span>
  </button>`;
}
