import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, gradeFor, buildQueue, dueDate, studyDay, recordDaily, todayCounters, DEFAULT_SRS } from '../../js/study/srs.js';
import { newSrsState } from '../../js/study/cards.js';

const MIN = 60000;
const DAY = 86400000;
const now = new Date(2026, 2, 3, 15, 0).getTime();

test('learning steps: 1 min, 10 min, then graduate to a day', () => {
  let s = schedule(newSrsState(), 'good', now);
  assert.equal(s.phase, 'learning');
  assert.equal(s.due - now, 10 * MIN);
  s = schedule(s, 'good', now);
  assert.equal(s.phase, 'review');
  assert.equal(s.interval, 1);
  assert.equal(s.due, dueDate(now, 1));
  assert.equal(new Date(s.due).getHours(), 4);
  const again = schedule(newSrsState(), 'again', now);
  assert.equal(again.due - now, MIN);
  const hard = schedule(newSrsState(), 'hard', now);
  assert.equal(hard.due - now, 1.5 * MIN);
});

test('easy on a new card graduates at four days with extra ease', () => {
  const s = schedule(newSrsState(), 'easy', now, 0.5);
  assert.equal(s.phase, 'review');
  assert.equal(s.interval, 4);
  assert.equal(s.ease, 2.65);
});

test('review intervals: ease, hard floor, fuzz and lapse', () => {
  const base = { ...newSrsState(), phase: 'review', interval: 10, ease: 2.5, reps: 3 };
  assert.equal(schedule(base, 'good', now, 0.5).interval, 25);
  assert.equal(schedule(base, 'good', now, 1).interval, 25 * 1.05);
  assert.equal(schedule(base, 'good', now, 0).interval, 25 * 0.95);
  assert.equal(schedule(base, 'easy', now, 0.5).interval, 10 * 2.5 * 1.3);
  const oneDay = { ...base, interval: 1 };
  assert.equal(schedule(oneDay, 'hard', now, 0.5).interval, 2);
  assert.equal(schedule(oneDay, 'hard', now, 0.5).ease, 2.35);
  const lapsed = schedule(base, 'again', now);
  assert.equal(lapsed.phase, 'relearning');
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.ease, 2.3);
  assert.equal(lapsed.interval, 1);
  assert.equal(lapsed.due - now, 10 * MIN);
  const back = schedule(lapsed, 'good', now, 0.5);
  assert.equal(back.phase, 'review');
  assert.equal(back.interval, 1);
});

test('leeches are suspended at eight lapses; ease is clamped', () => {
  const s = schedule({ ...newSrsState(), phase: 'review', interval: 3, ease: 1.35, lapses: 7 }, 'again', now);
  assert.equal(s.suspended, true);
  assert.equal(s.ease, DEFAULT_SRS.minimumEase);
});

test('grading policy', () => {
  assert.equal(gradeFor({ kind: 'first', elapsed: 1, promotion: false }, 'review'), 'easy');
  assert.equal(gradeFor({ kind: 'first', elapsed: 1, promotion: true }, 'review'), 'good');
  assert.equal(gradeFor({ kind: 'first', elapsed: 1, promotion: false }, 'new'), 'good');
  assert.equal(gradeFor({ kind: 'first', elapsed: 5, promotion: false }, 'review'), 'good');
  assert.equal(gradeFor({ kind: 'hint' }, 'review'), 'hard');
  assert.equal(gradeFor({ kind: 'retry', attempts: 1 }, 'review'), 'hard');
  assert.equal(gradeFor({ kind: 'retry', attempts: 2 }, 'review'), 'again');
  assert.equal(gradeFor({ kind: 'wrong' }, 'new'), 'again');
  assert.equal(gradeFor({ kind: 'skip' }, 'new'), null);
});

test('queue: learning first, reviews capped, new cards breadth-first and interleaved', () => {
  const c = (id, phase, due, depth = 0, chapterOrder = 0, extra = {}) => ({ id, study: 'S', depth, chapterOrder, srs: { ...newSrsState(), phase, due, ...extra } });
  const cards = [
    c('n-deep', 'new', 0, 9),
    c('n-shallow', 'new', 0, 1),
    c('l1', 'learning', now - 5),
    c('l-later', 'learning', now + DAY),
    ...Array.from({ length: 6 }, (_, i) => c(`r${i}`, 'review', now - (10 - i) * DAY)),
    c('sus', 'review', 0, 0, 0, { suspended: true }),
  ];
  const q = buildQueue(cards, { now });
  assert.deepEqual(q, ['l1', 'r0', 'r1', 'r2', 'r3', 'n-shallow', 'r4', 'r5', 'n-deep']);
  const capped = buildQueue(cards, { now, reviewsToday: 118, newToday: 14 });
  assert.deepEqual(capped, ['l1', 'r0', 'r1', 'n-shallow']);
  assert.deepEqual(buildQueue(cards, { now, studies: new Set(['other']) }), []);
});

test('study day rolls over at 04:00 and the streak counts consecutive days', () => {
  const late = new Date(2026, 2, 4, 1, 30).getTime();
  assert.equal(studyDay(late), studyDay(now));
  let st = recordDaily({}, 'new', now);
  assert.deepEqual([st.newToday, st.reviewsToday, st.streak], [1, 0, 1]);
  st = recordDaily(st, 'review', late);
  assert.deepEqual([st.newToday, st.reviewsToday, st.streak], [1, 1, 1]);
  st = recordDaily(st, 'review', now + DAY);
  assert.deepEqual([st.newToday, st.reviewsToday, st.streak], [0, 1, 2]);
  st = recordDaily(st, 'review', now + 4 * DAY);
  assert.equal(st.streak, 1);
  assert.equal(st.longestStreak, 2);
  assert.equal(todayCounters(st, now + 10 * DAY).streak, 0);
  assert.equal(todayCounters(st, now + 4 * DAY).reviewsToday, 1);
});
