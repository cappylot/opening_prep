// Spaced repetition (port of SRSTypes, SRSScheduler, DrillOutcome and
// ReviewQueueBuilder): SM-2 with Anki-style learning steps. Pure; `now` and
// `randomness` are passed in so every transition is reproducible.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export const DEFAULT_SRS = Object.freeze({
  learningSteps: [1, 10],
  relearningSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  minimumEase: 1.3,
  maximumEase: 3.0,
  easeAgain: -0.2,
  easeHard: -0.15,
  easeGood: 0,
  easeEasy: 0.15,
  hardMultiplier: 1.2,
  easyBonus: 1.3,
  lapseMultiplier: 0,
  minimumReviewInterval: 1,
  maximumInterval: 365 * 3,
  leechThreshold: 8,
  leechSuspends: true,
  newPerDay: 15,
  reviewsPerDay: 120,
  fuzz: 0.05,
  rolloverHour: 4,
});

export const srsSettings = (s) => ({ ...DEFAULT_SRS, ...(s || {}) });

/** Start of the study day `t` belongs to (a 01:00 review counts for the day before). */
export function studyDay(t, rolloverHour = 4) {
  const d = new Date(t - rolloverHour * HOUR);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Day intervals land at the rollover hour of the target study day. */
export function dueDate(now, days, rolloverHour = 4) {
  const d = new Date(studyDay(now, rolloverHour));
  d.setDate(d.getDate() + Math.round(days));
  d.setHours(rolloverHour, 0, 0, 0);
  return d.getTime();
}

/** Calendar-day step, safe across DST. */
export function addDays(dayStart, n) {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export const isDue = (state, now) => !state.suspended && state.due <= now;

/** Next state after a grade (again|hard|good|easy). */
export function schedule(state, grade, now, randomness = 0.5, settings = DEFAULT_SRS) {
  const s = srsSettings(settings);
  const next = { ...state, lastReviewed: now };
  if (state.phase === 'new' || state.phase === 'learning') learning(next, grade, now, s);
  else if (state.phase === 'review') review(next, grade, now, randomness, s);
  else relearning(next, grade, now, randomness, s);
  return next;
}

const clampEase = (e, s) => Math.min(Math.max(e, s.minimumEase), s.maximumEase);
function fuzz(days, r, s) {
  if (days < 2 || s.fuzz <= 0) return days;
  const c = Math.min(Math.max(r, 0), 1);
  return days * (1 + s.fuzz * (2 * c - 1));
}

function graduate(st, days, now, s) {
  st.phase = 'review';
  st.step = 0;
  st.reps = Math.max(st.reps, 0) + 1;
  if (!st.ease) st.ease = s.startingEase;
  st.interval = Math.min(days, s.maximumInterval);
  st.due = dueDate(now, st.interval, s.rolloverHour);
}

function learning(st, grade, now, s) {
  const steps = s.learningSteps.length ? s.learningSteps : [1];
  if (grade === 'again') {
    st.phase = 'learning';
    st.step = 0;
    st.due = now + steps[0] * MIN;
  } else if (grade === 'hard') {
    st.phase = 'learning';
    st.due = now + steps[Math.min(st.step, steps.length - 1)] * 1.5 * MIN;
  } else if (grade === 'good') {
    const n = st.step + 1;
    if (n >= steps.length) graduate(st, s.graduatingInterval, now, s);
    else {
      st.phase = 'learning';
      st.step = n;
      st.due = now + steps[n] * MIN;
    }
  } else {
    st.ease = clampEase(s.startingEase + s.easeEasy, s);
    graduate(st, s.easyInterval, now, s);
  }
}

function review(st, grade, now, r, s) {
  if (grade === 'again') {
    lapse(st, now, s);
    return;
  }
  const prev = Math.max(st.interval, 1);
  let interval = grade === 'hard' ? prev * s.hardMultiplier : grade === 'good' ? prev * st.ease : prev * st.ease * s.easyBonus;
  const delta = grade === 'hard' ? s.easeHard : grade === 'good' ? s.easeGood : s.easeEasy;
  st.ease = clampEase(st.ease + delta, s);
  st.reps += 1;
  // Floored at previous + 1 day, or `hard` on a one-day card pins it there forever.
  interval = Math.min(Math.max(interval, prev + 1), s.maximumInterval);
  st.interval = fuzz(interval, r, s);
  st.due = dueDate(now, st.interval, s.rolloverHour);
}

function relearning(st, grade, now, r, s) {
  const steps = s.relearningSteps.length ? s.relearningSteps : [10];
  if (grade === 'again') {
    st.step = 0;
    st.due = now + steps[0] * MIN;
  } else if (grade === 'hard') {
    st.due = now + steps[Math.min(st.step, steps.length - 1)] * 1.5 * MIN;
  } else {
    const n = st.step + 1;
    if (n >= steps.length) {
      let interval = Math.max(s.minimumReviewInterval, st.interval);
      if (grade === 'easy') interval *= s.easyBonus;
      interval = Math.min(interval, s.maximumInterval);
      st.phase = 'review';
      st.step = 0;
      st.interval = fuzz(interval, r, s);
      st.due = dueDate(now, st.interval, s.rolloverHour);
    } else {
      st.step = n;
      st.due = now + steps[n] * MIN;
    }
  }
}

function lapse(st, now, s) {
  const steps = s.relearningSteps.length ? s.relearningSteps : [10];
  st.lapses += 1;
  st.ease = clampEase(st.ease + s.easeAgain, s);
  st.phase = 'relearning';
  st.step = 0;
  st.interval = Math.max(s.minimumReviewInterval, st.interval * s.lapseMultiplier);
  st.due = now + steps[0] * MIN;
  if (s.leechSuspends && st.lapses >= s.leechThreshold) st.suspended = true;
}

/**
 * Drill outcome → grade. outcome: {kind:'first', elapsed, promotion} | {kind:'hint'}
 * | {kind:'retry', attempts} | {kind:'wrong'} | {kind:'skip'}. null means nothing is recorded.
 */
export function gradeFor(outcome, phase) {
  switch (outcome.kind) {
    case 'first':
      return phase === 'review' && outcome.elapsed < 3 && !outcome.promotion ? 'easy' : 'good';
    case 'hint':
      return 'hard';
    case 'retry':
      return outcome.attempts <= 1 ? 'hard' : 'again';
    case 'wrong':
      return 'again';
    default:
      return null;
  }
}

/**
 * Today's queue of card ids: due learning cards (uncapped), then due reviews
 * (oldest, then shallowest; capped) threaded with new cards breadth-first (capped),
 * one new card after every `interleave` reviews.
 * cards: [{id, srs, study, depth, chapterOrder}].
 */
export function buildQueue(cards, { now, newToday = 0, reviewsToday = 0, settings, studies = null, interleave = 4 }) {
  const s = srsSettings(settings);
  const pool = cards.filter((c) => !c.srs.suspended && (!studies || studies.has(c.study)));
  const learningCards = pool
    .filter((c) => (c.srs.phase === 'learning' || c.srs.phase === 'relearning') && c.srs.due <= now)
    .sort((a, b) => a.srs.due - b.srs.due);
  const reviews = pool
    .filter((c) => c.srs.phase === 'review' && c.srs.due <= now)
    .sort((a, b) => a.srs.due - b.srs.due || a.depth - b.depth)
    .slice(0, Math.max(0, s.reviewsPerDay - reviewsToday));
  const fresh = pool
    .filter((c) => c.srs.phase === 'new')
    .sort((a, b) => a.depth - b.depth || a.chapterOrder - b.chapterOrder)
    .slice(0, Math.max(0, s.newPerDay - newToday));

  const out = learningCards.map((c) => c.id);
  if (!fresh.length) return out.concat(reviews.map((c) => c.id));
  if (!reviews.length) return out.concat(fresh.map((c) => c.id));
  let r = 0;
  let f = 0;
  const step = Math.max(1, interleave);
  while (r < reviews.length || f < fresh.length) {
    for (let k = 0; k < step && r < reviews.length; k++) out.push(reviews[r++].id);
    if (f < fresh.length) out.push(fresh[f++].id);
    else if (r >= reviews.length) break;
  }
  return out;
}

/** Rolls today's counters and the streak forward for one graded answer. */
export function recordDaily(state, phaseBefore, now, rolloverHour = 4) {
  const next = { ...state };
  const today = studyDay(now, rolloverHour);
  if (next.lastCountedDay !== today) {
    next.lastCountedDay = today;
    next.newToday = 0;
    next.reviewsToday = 0;
  }
  if (phaseBefore === 'new') next.newToday = (next.newToday || 0) + 1;
  else next.reviewsToday = (next.reviewsToday || 0) + 1;
  if (next.lastStudyDay != null) {
    if (next.lastStudyDay < today) {
      next.streak = next.lastStudyDay >= addDays(today, -1) ? (next.streak || 0) + 1 : 1;
    }
  } else next.streak = 1;
  next.longestStreak = Math.max(next.longestStreak || 0, next.streak || 0);
  next.lastStudyDay = today;
  return next;
}

/** Counters as they stand on the study day containing `now` (zeroed after rollover). */
export function todayCounters(state, now, rolloverHour = 4) {
  const today = studyDay(now, rolloverHour);
  const same = state.lastCountedDay === today;
  const alive = state.lastStudyDay != null && state.lastStudyDay >= addDays(today, -1);
  return {
    newToday: same ? state.newToday || 0 : 0,
    reviewsToday: same ? state.reviewsToday || 0 : 0,
    streak: alive ? state.streak || 0 : 0,
    longestStreak: state.longestStreak || 0,
  };
}
