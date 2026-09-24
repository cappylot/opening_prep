// Settings sheet. Everything is saved on this device only.
import { useState, useEffect } from '../../vendor/preact/hooks.module.js';
import { html, Sheet, Chips, Toggle, toast } from '../ui.js';
import { clearAll } from '../store.js';

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
    if (!confirm('Delete all downloaded games, opponents and saved lines from this device?')) return;
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

    <label class="field-label">Board</label>
    <div class="board-swatches">
      ${['brown', 'blue', 'green', 'grey'].map(
        (b) => html`<button class=${`swatch board-${b} ${settings.board === b ? 'on' : ''}`} aria-label=${b} aria-pressed=${settings.board === b}
          onClick=${() => updateSettings({ board: b })}><span /><span /><span /><span /></button>`
      )}
    </div>

    <label class="field-label">Arrows on the board</label>
    <${Chips} options=${[2, 3, 4, 6].map((v) => ({ value: v, label: String(v) }))} value=${settings.arrows}
      onChange=${(v) => updateSettings({ arrows: v })} />

    <${Toggle} label="Board coordinates" checked=${settings.coords} onChange=${(v) => updateSettings({ coords: v })} />
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

    <label class="field-label" for="me">Your Lichess username (optional)</label>
    <input id="me" class="input" value=${me} autocapitalize="off" autocorrect="off" spellcheck=${false} placeholder="Shows your head-to-head record"
      onInput=${(e) => setMe(e.currentTarget.value)} />

    <label class="field-label" for="token">Lichess API token (optional)</label>
    <input id="token" class="input" type="password" value=${token} autocomplete="off" placeholder="lip_…"
      onInput=${(e) => setToken(e.currentTarget.value)} />
    <p class="hint">Downloads get faster with a token. Create one with <b>no scopes</b> at
      <a href="https://lichess.org/account/oauth/token/create?description=Opening+Prep" target="_blank" rel="noopener">lichess.org/account/oauth/token</a>.
      It stays on this device and is only sent to lichess.org.</p>

    <div class="danger-zone">
      <button class="btn danger block" onClick=${wipe}>Clear all data on this device</button>
    </div>
    <p class="hint center">Opening Prep · data from lichess.org · <a href="https://github.com/cappylot/opening_prep" target="_blank" rel="noopener">source</a></p>
    <button class="btn primary block" onClick=${close}>Done</button>
  </${Sheet}>`;
}
