// Settings sheet. Everything is saved on this device only.
import { useState, useEffect } from '../../vendor/preact/hooks.module.js';
import { html, Sheet, Chips, Toggle, toast } from '../ui.js';
import { clearAll } from '../store.js';
import { Board } from '../board.js';
import { lib, setApp, resetProgress, seedBundled } from '../study/studyStore.js';
import { DEFAULT_SRS, srsSettings } from '../study/srs.js';
import { useLibrary } from './study/common.js';

// Board themes: the original four plus the iOS app's eight.
export const BOARD_THEMES = [
  ['brown', 'Brown'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['grey', 'Grey'],
  ['classicGreen', 'Classic Green'],
  ['warmWalnut', 'Warm Walnut'],
  ['blueStudy', 'Blue Study'],
  ['marble', 'Marble'],
  ['blueprint', 'Blueprint'],
  ['artDeco', 'Art Deco'],
  ['circuit', 'Circuit Board'],
  ['sportsCourt', 'Sports Court'],
];
export const PIECE_SETS = [
  ['cburnett', 'Classic'],
  ['sashiteMerida', 'Sashité Merida'],
  ['artDecoMonochrome', 'Art Deco'],
  ['brutalistMonochrome', 'Brutalist'],
  ['origamiMonochrome', 'Origami'],
  ['circuitBoardMonochrome', 'Circuit Board'],
  ['blueprintMonochrome', 'Blueprint'],
  ['sportsMonochrome', 'Sports'],
];
const PREVIEW_FEN = 'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4';

function BoardSection({ settings, updateSettings }) {
  const anim = settings.animation;
  return html`
    <label class="field-label">Board & pieces</label>
    <div class="preview-board">
      <${Board} fen=${PREVIEW_FEN} orientation="white" turnColor="white" viewOnly=${true} coords=${settings.coords}
        theme=${settings.board} pieces=${settings.pieces} animation=${anim} lastMoveHighlight=${settings.lastMove}
        lastMove=${['b5', 'a4'].reverse()} decoration=${settings.decoration}
        shapes=${[{ orig: 'b5', dest: 'c6', brush: 'deco' }]} highlights=${new Map([['e5', 'mark']])} />
    </div>
    <div class="board-swatches wrap">
      ${BOARD_THEMES.map(
        ([b, name]) => html`<button class=${`swatch board-${b} ${settings.board === b ? 'on' : ''}`} aria-label=${name} title=${name}
          aria-pressed=${settings.board === b} onClick=${() => updateSettings({ board: b })}><span /><span /><span /><span /></button>`
      )}
    </div>
    <div class="piece-sets">
      ${PIECE_SETS.map(
        ([p, name]) => html`<button class=${`piece-set pieces-${p} ${settings.pieces === p ? 'on' : ''}`} aria-pressed=${settings.pieces === p}
          onClick=${() => updateSettings({ pieces: p })} title=${name}>
          <span class="cg-wrap piece-thumb"><piece class="knight white" /><piece class="king black" /></span><small>${name}</small>
        </button>`
      )}
    </div>
    <label class="toggle-row">
      <span><span class="toggle-label">Arrow and mark colour</span><small>Study arrows and highlighted squares</small></span>
      <input type="color" value=${settings.decoration} onInput=${(e) => updateSettings({ decoration: e.currentTarget.value })} aria-label="Arrow and mark colour" />
    </label>
    <${Toggle} label="Board coordinates" checked=${settings.coords} onChange=${(v) => updateSettings({ coords: v })} />
    <${Toggle} label="Highlight the last move" checked=${settings.lastMove} onChange=${(v) => updateSettings({ lastMove: v })} />
    <label class="toggle-row">
      <span><span class="toggle-label">Move animation</span><small>${anim === 0 ? 'Instant' : `${anim.toFixed(2)} s`}</small></span>
      <input type="range" min="0" max="0.8" step="0.05" value=${anim} aria-label="Move animation duration"
        onInput=${(e) => updateSettings({ animation: Number(e.currentTarget.value) })} />
    </label>`;
}

function SrsSection() {
  useLibrary();
  const s = srsSettings(lib().app.srs);
  const set = (patch) => setApp({ srs: { ...(lib().app.srs || {}), ...patch } });
  const num = (label, key, min, max, hint) => html`<label class="toggle-row">
    <span><span class="toggle-label">${label}</span>${hint ? html`<small>${hint}</small>` : ''}</span>
    <input class="input num-input" type="number" min=${min} max=${max} value=${s[key]}
      onChange=${(e) => {
        const v = Math.round(Number(e.currentTarget.value));
        if (Number.isFinite(v) && v >= min && v <= max) set({ [key]: v });
      }} />
  </label>`;
  const steps = (label, key) => html`<label class="toggle-row">
    <span><span class="toggle-label">${label}</span><small>Minutes, separated by spaces</small></span>
    <input class="input num-input wide" value=${s[key].join(' ')}
      onChange=${(e) => {
        const v = e.currentTarget.value.split(/[\s,]+/).map(Number).filter((x) => x > 0 && x < 10000);
        if (v.length) set({ [key]: v });
      }} />
  </label>`;
  return html`
    <label class="field-label">Spaced repetition</label>
    ${num('New cards per day', 'newPerDay', 0, 500)}
    ${num('Reviews per day', 'reviewsPerDay', 0, 5000)}
    ${steps('Learning steps', 'learningSteps')}
    ${steps('Relearning steps', 'relearningSteps')}
    ${num('New day starts at', 'rolloverHour', 0, 23, 'Hour of the day')}
    ${num('Suspend after lapses', 'leechThreshold', 2, 99, 'Positions missed this often are set aside')}
    <button class="btn ghost small" onClick=${() => setApp({ srs: { ...DEFAULT_SRS } })}>Reset to defaults</button>`;
}

export function SettingsSheet({ open, onClose, settings, updateSettings }) {
  const [me, setMe] = useState(settings.me);
  const [token, setToken] = useState(settings.token);
  useEffect(() => {
    if (open) {
      setMe(settings.me);
      setToken(settings.token);
    }
  }, [open]);

  const close = () => {
    const patch = {};
    if (me.trim() !== settings.me) patch.me = me.trim();
    if (token.trim() !== settings.token) patch.token = token.trim();
    if (Object.keys(patch).length) updateSettings(patch);
    onClose();
  };

  const wipe = async () => {
    if (!confirm('Delete all studies, progress, downloaded games, opponents and saved lines from this device?')) return;
    await clearAll();
    toast('All data cleared');
    location.hash = '#/';
    location.reload();
  };

  return html`<${Sheet} open=${open} title="Settings" onClose=${close}>
    <label class="field-label">Theme</label>
    <${Chips} options=${[
      { value: 'system', label: 'System' },
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ]} value=${settings.theme} onChange=${(v) => updateSettings({ theme: v })} />

    <${BoardSection} settings=${settings} updateSettings=${updateSettings} />

    <label class="field-label">Arrows on the board</label>
    <${Chips} options=${[2, 3, 4, 6].map((v) => ({ value: v, label: String(v) }))} value=${settings.arrows}
      onChange=${(v) => updateSettings({ arrows: v })} />

    <label class="field-label">Drills</label>
    <${Toggle} label="Pause after each answer" hint="Wait for Continue instead of playing on by itself"
      checked=${settings.drillPacing === 'manual'} onChange=${(v) => updateSettings({ drillPacing: v ? 'manual' : 'auto' })} />
    <${SrsSection} />

    <label class="field-label">Engine</label>
    <${Chips} options=${[
      { value: 'both', label: 'Cloud + device' },
      { value: 'cloud', label: 'Cloud only' },
      { value: 'off', label: 'Off' },
    ]} value=${settings.engine} onChange=${(v) => updateSettings({ engine: v })} />
    <p class="hint">Uses Lichess's cloud analysis when it has the position, otherwise runs Stockfish on this device
      (a one-time ~7 MB download, then works offline).</p>
    ${settings.engine === 'both'
      ? html`<label class="field-label">Device depth</label>
          <${Chips} options=${[14, 18, 22].map((v) => ({ value: v, label: String(v) }))} value=${settings.engineDepth}
            onChange=${(v) => updateSettings({ engineDepth: v })} />
          <p class="hint">Deeper is stronger but slower and uses more battery.</p>`
      : ''}
    <${Toggle} label="Engine best-move arrow" checked=${settings.evalArrow} onChange=${(v) => updateSettings({ evalArrow: v })} />
    <${Toggle} label="Vibration" hint="On supported phones" checked=${settings.haptics} onChange=${(v) => updateSettings({ haptics: v })} />

    <label class="field-label" for="me">Your Lichess profile (optional)</label>
    <input id="me" class="input" value=${me} autocapitalize="off" autocorrect="off" spellcheck=${false} placeholder="For head-to-head records and importing your games"
      onInput=${(e) => setMe(e.currentTarget.value)} />

    <label class="field-label" for="token">Lichess API token (optional)</label>
    <input id="token" class="input" type="password" value=${token} autocomplete="off" placeholder="lip_…"
      onInput=${(e) => setToken(e.currentTarget.value)} />
    <p class="hint">Downloads get faster with a token. Create one with <b>no scopes</b> at
      <a href="https://lichess.org/account/oauth/token/create?description=Opening+Prep" target="_blank" rel="noopener">lichess.org/account/oauth/token</a>.
      It stays on this device and is only sent to lichess.org.</p>

    <div class="danger-zone">
      <button class="btn block" onClick=${async () => {
        const n = await seedBundled({ force: true });
        toast(`${n} curated stud${n === 1 ? 'y' : 'ies'} restored`, 'ok');
      }}>Restore curated studies</button>
      <button class="btn block" onClick=${() => confirm('Reset progress on every study? The moves stay; every schedule starts over.') && resetProgress().then(() => toast('Progress reset'))}>
        Reset all study progress</button>
      <button class="btn danger block" onClick=${wipe}>Clear all data on this device</button>
    </div>
    <p class="hint center">Opening Prep · data from lichess.org · <a href="https://github.com/cappylot/opening_prep" target="_blank" rel="noopener">source</a></p>
    <button class="btn primary block" onClick=${close}>Done</button>
  </${Sheet}>`;
}
