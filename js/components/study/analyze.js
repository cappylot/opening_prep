// "Analyse position" sheet (port of AnalyzePositionSheet / EvaluationBarView):
// Lichess cloud eval with three lines, falling back to Stockfish on this device.
import { useEffect, useRef, useState } from '../../../vendor/preact/hooks.module.js';
import { html, Sheet, Icon, toast } from '../../ui.js';
import { cloudEval } from '../../lichess.js';
import { getEngine, engineSupported } from '../../engine.js';
import { load, playUci } from '../../study/chess.js';

export const evalLabel = (e) => {
  if (!e) return '--';
  if (e.mate != null) return `M${Math.abs(e.mate)}`;
  const v = e.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
};

/** White's share of the bar: saturates at ±800 cp, mates pin it. */
export function whiteShare(e) {
  if (!e) return 0.5;
  if (e.mate != null) return e.mate > 0 ? 1 : 0;
  const cp = Math.max(-800, Math.min(800, e.cp));
  return 0.5 + cp / 1600;
}

export function EvalBar({ value }) {
  const w = whiteShare(value);
  return html`<div class="eval-bar" role="img" aria-label=${`Evaluation ${evalLabel(value)}`}>
    <span class="eb-black" style=${{ height: `${(1 - w) * 100}%` }} />
    <b class=${w >= 0.5 ? 'on-white' : 'on-black'}>${evalLabel(value)}</b>
  </div>`;
}

function sansOf(fen, moves, n = 8) {
  const chess = load(fen);
  const out = [];
  for (const u of moves.slice(0, n)) {
    const m = chess && playUci(chess, u);
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

export function AnalyzeSheet({ open, fen, settings, onClose }) {
  const [state, setState] = useState({ status: 'idle' });
  const deviceCtrl = useRef(null);

  const device = async () => {
    deviceCtrl.current?.abort();
    deviceCtrl.current = new AbortController();
    const signal = deviceCtrl.current.signal;
    setState({ status: 'device', lines: [] });
    try {
      const r = await getEngine().analyse(fen, {
        depth: settings.engineDepth,
        signal,
        onInfo: (info) => setState({ status: 'device', running: true, depth: info.depth, lines: [{ cp: info.cp, mate: info.mate, moves: info.pv || [] }] }),
      });
      if (r && !signal.aborted) setState((s) => ({ ...s, running: false, depth: r.depth ?? s.depth, lines: r.pv ? [{ cp: r.cp, mate: r.mate, moves: r.pv }] : s.lines }));
      else if (!signal.aborted) setState((s) => ({ ...s, running: false }));
    } catch {
      if (!signal.aborted) setState({ status: 'error' });
    }
  };

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    cloudEval(fen, { signal: ctrl.signal, timeout: 5000, multiPv: 3 })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.status === 'ok') setState({ status: 'cloud', depth: r.result.depth, lines: r.result.pvs || [{ cp: r.result.cp, mate: r.result.mate, moves: r.result.pv }] });
        else if (r.status === 'limited') setState({ status: 'limited' });
        else setState({ status: r.status === 'miss' ? 'miss' : 'error' });
      })
      .catch(() => {});
    return () => (ctrl.abort(), deviceCtrl.current?.abort());
  }, [open, fen]);

  const canDevice = settings.engine !== 'off' && engineSupported();
  const top = state.lines?.[0];
  const copy = () =>
    navigator.clipboard?.writeText(fen).then(
      () => toast('FEN copied', 'ok'),
      () => toast('Could not copy', 'error'),
    );

  return html`<${Sheet} open=${open} title="Analyse position" onClose=${onClose} class="analyze-sheet">
    <div class="analyze">
      <${EvalBar} value=${top} />
      <div class="analyze-main">
        ${state.status === 'loading'
          ? html`<p class="muted">Asking the Lichess cloud…</p>`
          : state.status === 'miss' || state.status === 'limited' || state.status === 'error'
          ? html`<div class="card boxed">
              <p><b>${state.status === 'miss' ? "This position isn't in the Lichess cloud database." : state.status === 'limited' ? 'Lichess asked us to slow down.' : 'Cloud analysis is unavailable.'}</b></p>
              ${canDevice
                ? html`<button class="btn primary" onClick=${device}><${Icon} name="cpu" size=${16} /> Analyse on this device</button>`
                : html`<p class="hint">Turn the engine on in Settings to analyse on this device.</p>`}
            </div>`
          : html`<p class="muted">
                <${Icon} name=${state.status === 'cloud' ? 'cloud' : 'cpu'} size=${14} class="inline-icon" />
                ${state.status === 'cloud' ? 'Lichess cloud' : 'Stockfish on this device'}${state.depth ? ` · depth ${state.depth}` : ''}${state.running ? ' · thinking…' : ''}
              </p>
              <ol class="pv-list">
                ${(state.lines || []).map(
                  (l, i) => html`<li key=${i}><b class="pv-eval">${evalLabel(l)}</b> <span class="line-moves">${sansOf(fen, l.moves).join(' ')}</span></li>`
                )}
              </ol>`}
        <label class="field-label">FEN</label>
        <div class="row gap">
          <input class="input fen-input" readonly value=${fen} onFocus=${(e) => e.currentTarget.select()} />
          <button class="btn" onClick=${copy}><${Icon} name="copy" size=${16} /></button>
        </div>
      </div>
    </div>
  </${Sheet}>`;
}
