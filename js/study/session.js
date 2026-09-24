// The one active drill (port of ActiveSessionStore.swift). Module-level so a
// drill keeps running while the user browses other tabs; the mini-player and
// the drill screen both read it.
import { DrillSession } from './drillSession.js';
import { planFor, commitReview, lib, markStudy } from './studyStore.js';

const listeners = new Set();
const active = {
  session: null,
  request: null,
  summary: null, // the last finished drill, outlives its session
  preparing: false,
  reading: null, // id of the study open in the sheet, for "now reading"
};

export const activeSession = () => active;
export const onSession = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = () => listeners.forEach((fn) => fn());

/** Plans and starts a drill; returns false when there is nothing to drill. */
export function startDrill(request, { animation = 0.2, manualPacing = () => false } = {}) {
  endDrill();
  active.preparing = true;
  notify();
  const plan = planFor(request);
  active.preparing = false;
  if (!plan) {
    notify();
    return false;
  }
  const session = new DrillSession(plan, {
    animation,
    manualPacing,
    commit: (c) => commitReview(c),
  });
  session.subscribe(() => {
    if (session.finished && active.session === session) active.summary = session.phase.summary;
    notify();
  });
  active.session = session;
  active.request = request;
  active.summary = null;
  const studyId = plan.lines[0]?.study;
  if (studyId && lib().studies.has(studyId)) markStudy(studyId, { lastOpened: Date.now() });
  session.start();
  notify();
  return true;
}

/** Ends the drill; a drill with answers leaves its summary behind. */
export function endDrill() {
  const s = active.session;
  if (!s) return;
  if (!s.finished && s.answered > 0) {
    s.finish(false);
    active.summary = s.phase.summary;
  }
  s.cancel();
  active.session = null;
  active.request = null;
  notify();
}

export function dismissSummary() {
  active.summary = null;
  if (active.session?.finished) active.session = null;
  notify();
}

export function setReading(studyId) {
  if (active.reading === studyId) return;
  active.reading = studyId;
  notify();
}
