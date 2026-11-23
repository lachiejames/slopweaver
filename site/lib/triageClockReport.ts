/**
 * What the page tells the desktop shell about its triage pass, so the countdown shows beside the Slopweaver menu bar
 * item and the floating notes carry their two triage buttons: a visible countdown
 * while a triage is running, the timer existing only while triage mode is on. Pure: the walk and whether the page's
 * clock is armed in, the report out.
 */
import type { TriageClockReport } from "./triageBridge";
import type { TriageWalk } from "./triageWalkTypes";

/**
 * The report for the pass as it stands. Triage is on while a pass runs (`triage_end` stops it, a reload stops it). Its
 * clock runs only while the page has one armed on the card in front of the owner, opened and unruled — the same card
 * `triageClockOwed` times; paused is the owner's `triage_clock`; anything else on is between cards.
 *
 * @param walk the pass now, `undefined` before the first `triage_next`
 * @param armedDeadlineMs when the page's armed timer runs out, at the length the card's clock was started with;
 *   `undefined` while none is armed — a card opened beside the pass disarms it without a write
 * @returns the report
 */
export function triageClockReportOf({
  walk,
  armedDeadlineMs,
}: {
  walk: TriageWalk | undefined;
  armedDeadlineMs: number | undefined;
}): TriageClockReport {
  if (walk === undefined || walk.stoppedMs !== undefined) {
    return { on: false };
  }
  if (walk.paused) {
    return { on: true, phase: "paused" };
  }
  const { current } = walk;
  if (armedDeadlineMs === undefined || current === undefined || !current.opened || current.ruled) {
    return { on: true, phase: "between" };
  }
  return { deadlineMs: armedDeadlineMs, on: true, phase: "running" };
}

/**
 * Whether two reports say the same thing, so the page sends the shell a change and never the same report twice.
 *
 * @param before the report last sent, `undefined` before the first
 * @param after the report now
 * @returns true when nothing the shell draws would change
 */
export function sameTriageClockReport({
  before,
  after,
}: {
  before: TriageClockReport | undefined;
  after: TriageClockReport;
}): boolean {
  if (before === undefined || before.on !== after.on) {
    return false;
  }
  if (!before.on || !after.on) {
    return true;
  }
  if (before.phase === "running" && after.phase === "running") {
    return before.deadlineMs === after.deadlineMs;
  }
  return before.phase === after.phase;
}
