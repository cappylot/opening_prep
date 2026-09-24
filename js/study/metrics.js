// Derived numbers for studies and the Practice screen (port of StudyMetrics.swift
// and PracticeView's aggregates). Pure.
import { addDays, studyDay } from './srs.js';

const active = (cards) => cards.filter((c) => !c.srs.suspended);

export const dueCount = (cards, now) => active(cards).filter((c) => c.srs.due <= now).length;

export function learnedFraction(cards) {
  const a = active(cards);
  return a.length ? a.filter((c) => c.srs.phase === 'review').length / a.length : 0;
}

export const sideName = (side) => (side === 'black' ? 'Black' : 'White');

export const studySubtitle = (study) => [`${sideName(study.side)} repertoire`, study.eco].filter(Boolean).join(' · ');

/** 64-bit FNV-1a of the slug, mod 1024: the same cover seed the iOS app uses. */
export function coverSeed(slug) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(slug)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number(h % 1024n);
}

/**
 * Daily share of non-"again" grades over `days` study days ending today.
 * Returns [{day, total, good, rate|null}], oldest first.
 */
export function accuracySeries(reviews, { now, days = 30, rolloverHour = 4 }) {
  const today = studyDay(now, rolloverHour);
  const start = addDays(today, -(days - 1));
  const buckets = new Map();
  for (let i = 0; i < days; i++) buckets.set(addDays(start, i), { total: 0, good: 0 });
  for (const r of reviews) {
    const d = studyDay(r.t, rolloverHour);
    const b = buckets.get(d);
    if (!b) continue;
    b.total += 1;
    if (r.grade !== 'again') b.good += 1;
  }
  return [...buckets].map(([day, b]) => ({ day, ...b, rate: b.total ? b.good / b.total : null }));
}

/** Cards with the most lapses, for "Needs work". */
export const needsWork = (cards, limit = 5) =>
  cards
    .filter((c) => c.srs.lapses > 0 && !c.orphan)
    .sort((a, b) => b.srs.lapses - a.srs.lapses || a.depth - b.depth)
    .slice(0, limit);

/** Case-insensitive search over studies and chapter lines. */
export function searchStudies(query, studies, chapters) {
  const q = query.trim().toLowerCase();
  if (!q) return { studies: [], chapters: [] };
  const hit = (s) => s && s.toLowerCase().includes(q);
  const byId = new Map(studies.map((s) => [s.id, s]));
  return {
    studies: studies.filter((s) => hit(s.title) || hit(s.eco) || hit(s.summary) || hit(`${sideName(s.side)} repertoire`)),
    chapters: chapters
      .filter((c) => byId.has(c.study) && (hit(c.title) || hit(c.searchLine)))
      .map((c) => ({ chapter: c, study: byId.get(c.study) })),
  };
}

/** Recent queries: newest first, deduped case-insensitively, 2+ chars, at most 8. */
export function pushRecent(recents, query) {
  const q = query.trim();
  if (q.length < 2) return recents;
  return [q, ...recents.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8);
}

/** Drill summary verdict tier. */
export function verdict(accuracy) {
  if (accuracy >= 0.9) return 'Sharp — that repertoire is holding.';
  if (accuracy >= 0.7) return 'Solid. The shaky ones will come back sooner.';
  return "Plenty came back wrong — they're scheduled tight now.";
}
