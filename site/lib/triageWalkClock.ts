/**
 * A voice triage pass's clock (`./triageWalk.ts` picks the cards): how long a card's clock runs, whether its time-up line
 * is owed, stopping and resuming the pass, and when a pass has sat idle too long to pick up. Pure, like the walk.
 */
import type { TriageVisit, TriageWalk } from "./triageWalkTypes";

/** How long a card's clock runs when the owner names no length: two minutes. */
export const TRIAGE_CARD_CLOCK_MS = 120_000;

/** How long a briefing's clock runs when the owner names no length: ten minutes, a card carrying a page to react to. */
export const TRIAGE_BRIEFING_CLOCK_MS = 600_000;

/** The longest clock the owner can name, in whole minutes: two hours. */
export const TRIAGE_CLOCK_MINUTES_MAX = 120;

/**
 * Whether a number of minutes is one the owner can name for a clock: a whole number from one to
 * {@link TRIAGE_CLOCK_MINUTES_MAX}.
 *
 * @param value what the model passed for the owner's length
 * @returns true for a whole number of minutes in range
 */
export function clockMinutesValid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= TRIAGE_CLOCK_MINUTES_MAX;
}

/**
 * How long a card's clock runs: the minutes the owner named, else ten minutes on a briefing and two on any other card.
 * The voice never picks a number; a length arrives only from the owner's own words (`./clockMinutesGuard.ts`).
 *
 * @param minutes the length the owner named, `undefined` when they named none
 * @param briefing the card carries a page to react to
 * @returns the clock's length in milliseconds
 */
export function triageClockLengthMs({ minutes, briefing }: { minutes: number | undefined; briefing: boolean }): number {
  if (minutes !== undefined) {
    return minutes * 60_000;
  }
  if (briefing) {
    return TRIAGE_BRIEFING_CLOCK_MS;
  }
  return TRIAGE_CARD_CLOCK_MS;
}

/**
 * A clock's length as the voice says it: "2 minutes", "1 minute".
 *
 * @param lengthMs the clock's length in milliseconds, a whole number of minutes
 * @returns the length in words
 */
export function clockLengthWords({ lengthMs }: { lengthMs: number }): string {
  const minutes = Math.round(lengthMs / 60_000);
  if (minutes === 1) {
    return "1 minute";
  }
  return `${String(minutes)} minutes`;
}

/**
 * Whether the time-up line is owed on a visit: the pass is running, it is the pass's current card, its open went
 * through, the owner has not ruled it, and the clock is not paused. What the page shows is not read here; a firing checks that
 * too, with {@link triageClockOwedOnScreen}.
 *
 * @param walk the pass now, `undefined` when there is none
 * @param visitId the visit whose clock ran out
 * @returns `true` when the voice should say the time is up
 */
export function triageClockOwed({ walk, visitId }: { walk: TriageWalk | undefined; visitId: string }): boolean {
  if (walk === undefined || walk.stoppedMs !== undefined || walk.paused) {
    return false;
  }
  const { current } = walk;
  return current?.visitId === visitId && current.opened && !current.ruled;
}

/**
 * Whether a firing clock is still owed its line, page included: {@link triageClockOwed}, and, when the card
 * has been on the owner's screen during this visit, it still is. A card shown and then closed, or left for another,
 * spends the firing. Measured: the clock started on a card, the owner closed it and opened another without ruling it,
 * and four minutes later the voice said "Two minutes are up. Why not park it" over a card the owner was not looking
 * at. A card the voice read with nothing open (the open-card switch off, or an open that failed) has no screen
 * to leave, so only the pass decides it, as before.
 *
 * @param shown the card was the open one on the page as any clock of this visit started, so a restart after the owner closed
 *   it is never read as a card shown nowhere
 * @param openKey the open card's key on the page now, `undefined` when none is open
 * @returns `true` when the voice should say the time is up
 */
export function triageClockOwedOnScreen({
  walk,
  visitId,
  shown,
  openKey,
}: {
  walk: TriageWalk | undefined;
  visitId: string;
  shown: boolean;
  openKey: string | undefined;
}): boolean {
  if (!triageClockOwed({ visitId, walk })) {
    return false;
  }
  return !shown || openKey === walk?.current?.key;
}

/**
 * Whether a firing clock posts its line now: still owed, and the owner's microphone quiet. Sounding, the
 * line waits for the next retry and stays owed, since the server's floor sees the owner's words only once their
 * transcript arrives. Measured: the line was taken while the owner was 90s into a bug report whose transcript had
 * stalled 84s before.
 *
 * @param owed whether the line is still owed ({@link triageClockOwedOnScreen})
 * @param microphoneSounding whether the owner's microphone carries their voice at this firing
 * @returns `true` when the page should post the line now
 */
export function triageDueReady({ owed, microphoneSounding }: { owed: boolean; microphoneSounding: boolean }): boolean {
  return owed && !microphoneSounding;
}

/**
 * The visit last put on the owner's screen as a clock started, once another clock starts on `visit`: this one when its
 * open says it put the card up — which the page's view may not show yet, as a browser open renders after it answers —
 * or its card is the open one now, else the one kept before. Kept across restarts, so a `triage_clock` restart after
 * the owner closed the card still reads it as shown.
 *
 * @param shownVisit the visit id kept so far, `undefined` for none
 * @param visit the visit whose clock is starting
 * @param opened the open that started this clock answered that the card is on the owner's screen; `false` for a restart
 * @param openKey the open card's key on the page now, `undefined` when none is open
 * @returns the visit id to keep
 */
export function shownVisitAfter({
  shownVisit,
  visit,
  opened,
  openKey,
}: {
  shownVisit: string | undefined;
  visit: Pick<TriageVisit, "key" | "visitId">;
  opened: boolean;
  openKey: string | undefined;
}): string | undefined {
  return opened || openKey === visit.key ? visit.visitId : shownVisit;
}

/**
 * Stop the pass without dropping it: the clock is owed nothing, and the next `triage_next` picks it up at the next
 * card the owner has not been shown — never back at the first card of a fresh pass, walking them again through every
 * card they already ruled. Measured: ending the pass to stop the clock dropped it, the next pass began at card 1 of
 * 93, and the voice skipped back through eight cards the owner had ruled, a second each, opening each one's Slack
 * thread.
 *
 * @param walk the running pass
 * @param nowMs when it stopped
 * @returns the pass, stopped
 */
export function stopTriageWalk({ walk, nowMs }: { walk: TriageWalk; nowMs: number }): TriageWalk {
  return { ...walk, stoppedMs: nowMs };
}

/**
 * Pick a stopped pass up again: everything it held, running. `triage_next` calls it before asking for the next card,
 * and only on a pass still inside the idle window ({@link triageWalkSpent}).
 *
 * @param walk the stopped pass
 * @returns the pass, running
 */
export function resumeTriageWalk({ walk }: { walk: TriageWalk }): TriageWalk {
  return { ...walk, stoppedMs: undefined };
}

/**
 * The visit the clock should run on now: the card in front of the owner while it is owed one, with its clock
 * counted afresh from `nowMs` — what resuming a paused clock arms, since the minutes paused through were not the
 * owner's to spend.
 *
 * @param walk the pass now
 * @param nowMs when the clock resumes
 * @returns the visit to time, or `undefined` when no card is owed a clock
 */
export function triageClockResumed({ walk, nowMs }: { walk: TriageWalk; nowMs: number }): TriageVisit | undefined {
  const { current } = walk;
  if (current === undefined || !triageClockOwed({ visitId: current.visitId, walk })) {
    return undefined;
  }
  return { ...current, presentedMs: nowMs };
}

/**
 * How long a pass may sit with no card put in front of the owner before "it's triaging time" begins a fresh one instead
 * of picking up where it stopped: past this, the Queue it began from is no longer the one the owner is looking at.
 */
export const TRIAGE_PASS_IDLE_MS = 30 * 60_000;

/**
 * Whether a pass has sat idle past {@link TRIAGE_PASS_IDLE_MS} — since a card was last put in front of the owner, or, once
 * `triage_end` stopped it, since it stopped. Neither coming to every card nor `triage_end` spends it: asked again, it
 * looks for a card sent back that is back, or one that arrived, and never walks a card shown a second time.
 *
 * @param walk the pass kept on the page
 * @param nowMs the instant judged at
 * @returns `true` when `triage_next` should begin a fresh pass
 */
export function triageWalkSpent({ walk, nowMs }: { walk: TriageWalk; nowMs: number }): boolean {
  let idleSinceMs = walk.touchedMs;
  if (walk.stoppedMs !== undefined) {
    idleSinceMs = walk.stoppedMs;
  }
  return nowMs - idleSinceMs > TRIAGE_PASS_IDLE_MS;
}
