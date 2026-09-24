// Hash routes.
//   Tabs:      #/ (home) · #/practice · #/library · #/library/all · #/search · #/opponents
//   Studies:   #/s/{slug} · #/s/{slug}/c/{chapterKey}?m=e2e4,e7e5 · #/s/{slug}/edit[/{chapterKey}]
//   Create:    #/create · #/create/pgn · #/create/lichess · #/create/board
//   Drill:     #/drill
//   Opponents: #/u/{name}?c=w&m=e2e4,c7c5&t=explore
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const movesOf = (q) => (q.get('m') || '').split(',').filter((x) => UCI.test(x));

export const TABS = ['home', 'practice', 'library', 'search', 'opponents'];

export function parseHash(hash = location.hash) {
  const [pathPart, query = ''] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (parts[0] === 'u' && parts[1]) {
    const c = q.get('c');
    return {
      view: 'prep',
      tab: 'opponents',
      name: parts[1],
      color: c === 'b' ? 'black' : c === 'w' ? 'white' : null,
      moves: movesOf(q),
      prepTab: ['explore', 'insights', 'lines'].includes(q.get('t')) ? q.get('t') : 'explore',
    };
  }
  if (parts[0] === 's' && parts[1]) {
    const slug = parts[1];
    if (parts[2] === 'c' && parts[3]) return { view: 'viewer', sheet: true, slug, key: parts[3], moves: movesOf(q) };
    if (parts[2] === 'edit') return { view: 'editor', sheet: true, slug, key: parts[3] || null };
    return { view: 'study', sheet: true, slug };
  }
  if (parts[0] === 'create') {
    const mode = ['pgn', 'lichess', 'board'].includes(parts[1]) ? parts[1] : null;
    return { view: mode ? `create-${mode}` : 'create', sheet: !!mode, tab: 'library' };
  }
  if (parts[0] === 'drill') return { view: 'drill', sheet: true };
  if (parts[0] === 'library') return { view: parts[1] === 'all' ? 'catalog' : 'library', tab: 'library' };
  if (TABS.includes(parts[0])) return { view: parts[0], tab: parts[0] };
  return { view: 'home', tab: 'home' };
}

export function prepHash(name, { color, moves = [], tab } = {}) {
  const q = new URLSearchParams();
  if (color) q.set('c', color[0]);
  if (moves.length) q.set('m', moves.join(','));
  if (tab && tab !== 'explore') q.set('t', tab);
  const qs = q.toString().replace(/%2C/g, ',');
  return `#/u/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
}

export const studyHash = (slug) => `#/s/${encodeURIComponent(slug)}`;
export const viewerHash = (slug, key, moves = []) =>
  `#/s/${encodeURIComponent(slug)}/c/${encodeURIComponent(key)}${moves.length ? `?m=${moves.join(',')}` : ''}`;
export const editorHash = (slug, key) => `#/s/${encodeURIComponent(slug)}/edit${key ? `/${encodeURIComponent(key)}` : ''}`;
export const tabHash = (tab) => (tab === 'home' ? '#/' : `#/${tab}`);

export const go = (hash) => {
  location.hash = hash;
};
