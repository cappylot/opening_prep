// Client-side filters for the loaded games (no re-download needed).
import { html, Sheet, Chips, Toggle, cap } from '../ui.js';

const PERIODS = [
  { value: 0, label: 'All' },
  { value: 365, label: '1 year' },
  { value: 182, label: '6 months' },
  { value: 91, label: '3 months' },
  { value: 30, label: '1 month' },
];
const HALF_LIVES = [
  { value: 0, label: 'Off' },
  { value: 365, label: 'Gentle' },
  { value: 90, label: 'Strong' },
];

export function filterSummary(f, settings) {
  const parts = [];
  parts.push(f.speeds.length ? f.speeds.map(cap).join(', ') : 'All speeds');
  if (f.periodDays) parts.push(PERIODS.find((p) => p.value === f.periodDays)?.label);
  if (f.ratedOnly) parts.push('Rated');
  if (settings.halfLife) parts.push('Recent+');
  return parts.join(' · ');
}

export function FilterSheet({ open, onClose, filters, setFilters, speeds, settings, updateSettings }) {
  const set = (patch) => setFilters({ ...filters, ...patch });
  return html`<${Sheet} open=${open} title="Filter games" onClose=${onClose}>
    <label class="field-label">Time controls</label>
    <${Chips} multi value=${filters.speeds} onChange=${(v) => set({ speeds: v })}
      options=${speeds.map(([s, n]) => ({ value: s, label: cap(s), count: n }))} />
    <p class="hint">None selected means all downloaded time controls.</p>
    <label class="field-label">Played within</label>
    <${Chips} options=${PERIODS} value=${filters.periodDays} onChange=${(v) => set({ periodDays: v })} />
    <${Toggle} label="Rated games only" checked=${filters.ratedOnly} onChange=${(v) => set({ ratedOnly: v })} />
    <label class="field-label">Favour recent games</label>
    <${Chips} options=${HALF_LIVES} value=${settings.halfLife} onChange=${(v) => updateSettings({ halfLife: v })} />
    <p class="hint">Weights newer games more, so a repertoire change shows up quickly. "Strong" halves a game's weight every 3 months.</p>
    <label class="field-label">Minimum games to trust a move</label>
    <${Chips} options=${[1, 2, 3, 5, 10].map((v) => ({ value: v, label: String(v) }))} value=${settings.minGames}
      onChange=${(v) => updateSettings({ minGames: v })} />
    <div class="row gap end">
      <button class="btn ghost" onClick=${() => setFilters({ speeds: [], ratedOnly: false, periodDays: 0 })}>Reset</button>
      <button class="btn primary" onClick=${onClose}>Done</button>
    </div>
  </${Sheet}>`;
}
