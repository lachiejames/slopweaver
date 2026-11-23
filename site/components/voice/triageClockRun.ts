/**
 * Run `triage_end` and `triage_clock` (`src/talk/triageToolSchemas.ts`), and stop a pass as the owner starts a fresh
 * call: every way the pass's clock stops, pauses or starts again on the card already in front of the owner. Opening the
 * next card is `./triageRun.ts`'s; every effect is a seam, so a test passes plain fakes.
 */
import { triageSummary } from "../../lib/triageWalk";
import { stopTriageWalk, triageClockResumed } from "../../lib/triageWalkClock";
import type { TriageVisit } from "../../lib/triageWalkTypes";
import { withRecordUnread } from "../../lib/voiceRecordQueue";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";
import type { OpenCardRan } from "./openCardRun";
import { fitTriageEnd } from "./triageEndFit";
import { cardClockLengthMs, clockNote, PAUSED_NOTE, type TriageSeams, triageWalkRows } from "./triageRun";

/**
 * Stop a pass still running as the owner starts a fresh call — their press, never a reconnect or a rollover, which carry
 * the call on. Triage is on only inside the call the owner asked for it in: a pass left running by an earlier call would
 * otherwise let a "next card" in this one carry on its clock, which the heard-word gate cannot see because a fresh
 * call's record starts empty. It keeps the owner's place exactly as `triage_end` does, so asking to
 * triage again inside the half hour picks it up.
 *
 * @param seams the page's pass and its clock
 */
export function stopTriageForFreshCall({ seams }: { seams: Pick<TriageSeams, "triage"> }): void {
  seams.triage.stopClock();
  const walk = seams.triage.read();
  if (walk === undefined || walk.stoppedMs !== undefined) {
    return;
  }
  seams.triage.write({ walk: stopTriageWalk({ nowMs: seams.triage.nowMs(), walk }) });
}

/** What `triage_end` tells the model about the place it keeps. */
const KEPT_NOTE =
  "the owner's place is kept for half an hour: if they triage again inside it, one triage_next brings the next card they have " +
  "not seen, or one they sent back now back rewritten, never another they ruled; after it a fresh pass begins, still " +
  "leaving out every card they ruled whose words have not changed";

/**
 * Run one `triage_end` call: stop the clock, stop the pass without dropping it (`stopTriageWalk`) and say what it came
 * to.
 *
 * @param seams what the call reaches
 * @returns the summary, or a refusal when no pass is running
 */
export function runTriageEnd({ seams }: { seams: Pick<TriageSeams, "cards" | "triage"> }): OpenCardRan {
  const walk = seams.triage.read();
  seams.triage.stopClock();
  if (walk === undefined || walk.stoppedMs !== undefined) {
    const why = "no triage pass is running: triage_next starts one";
    return { answer: { refused: why }, detail: "no triage pass", partialFailures: [], readText: false, refused: true };
  }
  seams.triage.write({ walk: stopTriageWalk({ nowMs: seams.triage.nowMs(), walk }) });
  const cards = seams.cards();
  const summary = triageSummary({ rows: triageWalkRows({ focuses: cards.focuses, rows: cards.rows }), walk });
  return {
    answer: withRecordUnread({
      answer: fitTriageEnd({ answer: { ended: true, note: KEPT_NOTE, rulings: walk.rulings, summary } }),
      capBytes: TOOL_OUTPUT_MAX,
      unread: cards.unread,
    }),
    detail: `triage ended, ${String(summary.seen)} of ${String(summary.of)} seen`,
    partialFailures: [],
    readText: false,
    refused: false,
  };
}

/** What `triage_clock` says when it starts the clock with no card in front of the owner to time. */
const NO_CARD_NOTE = "the clock is on: the next card the owner is shown gets its own";

/**
 * The length a restarted clock runs on the card in front of the owner: the minutes the owner just named, else the
 * length this page kept for the visit, else the card's own default.
 *
 * @param seams the pass and the Queue
 * @param visit the card being timed again
 * @param minutes the length the owner just named, `undefined` when they named none
 * @returns the length in milliseconds
 */
function restartLengthMs({
  seams,
  visit,
  minutes,
}: {
  seams: Pick<TriageSeams, "cards" | "triage">;
  visit: TriageVisit;
  minutes: number | undefined;
}): number {
  const kept = seams.triage.lengthOf({ visitId: visit.visitId });
  if (minutes === undefined && kept !== undefined) {
    return kept;
  }
  return cardClockLengthMs({ key: visit.key, minutes, rows: seams.cards().rows });
}

/**
 * Run one `triage_clock` call: pause the owner's card clock, or start it again. Without this tool, a request to
 * pause the timer can only end the pass. Paused, the pass goes on and no card gets the time-up line; running again, the
 * card in front of the owner gets a fresh clock — of the minutes the owner just named ("ten on this one"), else the
 * length it ran before.
 *
 * @param seams what the call reaches
 * @param state `paused` or `running`, as the owner's words asked
 * @param minutes the length the owner named for the card in front of them, already checked against their words;
 *   `undefined` when they named none, and always on a pause
 * @returns where the clock now stands, or a refusal when no pass is running
 */
export function runTriageClock({
  seams,
  state,
  minutes,
}: {
  seams: Pick<TriageSeams, "cards" | "triage">;
  state: "paused" | "running";
  minutes: number | undefined;
}): OpenCardRan & { readonly triageVisit?: string } {
  const walk = seams.triage.read();
  if (walk === undefined || walk.stoppedMs !== undefined) {
    const why = "no triage pass is running: there is no clock to pause or start";
    return { answer: { refused: why }, detail: "no triage pass", partialFailures: [], readText: false, refused: true };
  }
  const next = { ...walk, paused: state === "paused" };
  seams.triage.stopClock();
  const resumed = next.paused ? undefined : triageClockResumed({ nowMs: seams.triage.nowMs(), walk: next });
  let note = PAUSED_NOTE;
  if (!next.paused) {
    note = NO_CARD_NOTE;
  }
  if (resumed === undefined) {
    seams.triage.write({ walk: next });
  } else {
    const lengthMs = restartLengthMs({ minutes, seams, visit: resumed });
    seams.triage.write({ walk: { ...next, current: resumed } });
    seams.triage.startClock({ lengthMs, shown: false, visit: resumed });
    note = clockNote({ lengthMs });
  }
  const ran = {
    answer: { clock: state, note },
    detail: `triage clock ${state}`,
    partialFailures: [],
    readText: false,
    refused: false,
  };
  // The answer names the card whose clock it restarted, so the server takes its due line again; a pause names none,
  // and clears it there.
  return resumed === undefined ? ran : { ...ran, triageVisit: resumed.visitId };
}
