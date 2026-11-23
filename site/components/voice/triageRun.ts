/**
 * Run `triage_next` (`src/talk/triageToolSchemas.ts`) over the page's pass (`../../lib/triageWalk.ts`): it picks the
 * card and puts it in front of the owner through `open_card`'s own presenter (`./openCardRun.ts`), so a triage card
 * opens exactly as any card the voice opens; then it starts the card's clock, at the length the owner named or the
 * card's own default. Ending the pass and pausing or restarting its clock is `./triageClockRun.ts`'s. Its own file so
 * `talkToolRun.ts` stays under the line cap; every effect is a seam, so a test passes plain fakes.
 */
import { type QueueFocus, queueOrdered, queueSectionOf } from "../../lib/queueFocus";
import type { QueueRow } from "../../lib/queueRows";
import { cardForVoice } from "../../lib/queueVoice";
import { TRIAGE_NOT_ASKED_REFUSAL } from "../../lib/triageAskGuard";
import { markTriageOpened, nextTriageCard, startTriageWalk, triageSummary } from "../../lib/triageWalk";
import {
  clockLengthWords,
  resumeTriageWalk,
  triageClockLengthMs,
  triageClockOwed,
  triageWalkSpent,
} from "../../lib/triageWalkClock";
import type { TriageFront, TriageVisit, TriageWalk, TriageWalkRow } from "../../lib/triageWalkTypes";
import { trackedCardReads, withRecordUnread } from "../../lib/voiceRecordQueue";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";
import { type OpenCardRan, type OpenCardSeams, runOpenCard, SWITCHED_OFF } from "./openCardRun";

/** Where the pass lives and how its clock runs: the page's (`./useTriageWalk.ts`), a plain fake in a test. */
export interface TriageWalkSeams {
  /** The pass now — running or stopped — `undefined` before the first `triage_next`. */
  readonly read: () => TriageWalk | undefined;
  /** Keep the pass. It never takes `undefined`: ending stops a pass, and no tool can drop the owner's place in one. */
  readonly write: (input: { readonly walk: TriageWalk }) => void;
  /** A fresh id for a pass, a UUID. */
  readonly mintId: () => string;
  readonly nowMs: () => number;
  /**
   * Start the card's clock at `lengthMs` from the visit's `presentedMs`, replacing any clock already running, and keep
   * that length for the visit. `shown` is the open's own word that it put the card on the owner's screen, which the
   * page's view may not show yet; a restart passes `false`.
   */
  readonly startClock: (input: {
    readonly visit: TriageVisit;
    readonly shown: boolean;
    readonly lengthMs: number;
  }) => void;
  readonly stopClock: () => void;
  /** Keep a visit's clock length without starting it: a card opened while the owner has the clock paused. */
  readonly keepLength: (input: { readonly visitId: string; readonly lengthMs: number }) => void;
  /** The clock length kept for a visit, `undefined` when this page kept none (another tab opened it). */
  readonly lengthOf: (input: { readonly visitId: string }) => number | undefined;
  /** Note one of the model's answers beginning, with the card in front of the owner now (`../../lib/triageTurnFronts.ts`). */
  readonly turnStarted: (input: { readonly turnId: string }) => void;
  /** The card in front of the owner as an answer began, which a ruling in it binds to. */
  readonly frontOf: (input: { readonly answerId: string | undefined }) => TriageFront;
}

/** What the triage tools reach. */
export interface TriageSeams extends OpenCardSeams {
  readonly triage: TriageWalkSeams;
  /**
   * Whether the owner's own newest words ask to triage (`../../lib/triageAskGuard.ts`), which a pass needs to begin or be
   * picked back up; a pass already running carries on without it.
   */
  readonly triageAsked: () => boolean;
}

/**
 * The words a card would be read out from, so a card back with other words reads as rewritten — never its age or
 * pill, which move without anyone touching the card.
 *
 * @param row a Queue row
 * @returns the fingerprint
 */
function wordsOf({ row }: { row: QueueRow }): string {
  const card = cardForVoice({ row });
  return JSON.stringify([
    card.question,
    card.subject,
    card.what,
    card.problem,
    card.examples,
    card.whyYou,
    card.options,
    card.rows,
    card.pastes,
    card.checklist,
    card.lean,
    card.ifSilent,
    card.draft,
    card.drafts,
  ]);
}

/**
 * The Queue's rows as the walk reads them, in the Queue's one order, each in the section the Queue draws it in.
 *
 * @param rows every row the Queue draws
 * @param focuses the workstreams lifted now, the owner's first priority first
 * @returns one walk row each, in the order the page numbers them
 */
export function triageWalkRows({
  rows,
  focuses,
}: {
  rows: readonly QueueRow[];
  focuses: readonly QueueFocus[];
}): readonly TriageWalkRow[] {
  return queueOrdered({ focuses, rows }).map((row) => {
    const walkRow = {
      fingerprint: wordsOf({ row }),
      key: row.key,
      kind: row.kind,
      section: queueSectionOf({ focuses, row }),
      tier: row.tier,
    };
    // A card stopping the owner's work is walked in its place, put off or not, as the Queue draws it
    // (`../../lib/queueStopping.ts`).
    if (row.deferredIso === undefined || row.stopping !== undefined) {
      return walkRow;
    }
    return { ...walkRow, deferredIso: row.deferredIso };
  });
}

/**
 * The fixed words a triage answer carries about the clock, so the voice never invents one: the length it runs, which
 * is the owner's or the card's own default, never the voice's.
 *
 * @param lengthMs the card's clock length
 * @returns the note
 */
export function clockNote({ lengthMs }: { lengthMs: number }): string {
  return (
    `${clockLengthWords({ lengthMs })} on this card, counting down beside the owner's menu bar item; on a call you ` +
    "are told when it is up. The owner can name another length for it; never pick one yourself"
  );
}

/** The same, while the owner has the clock paused. */
export const PAUSED_NOTE = "the owner's clock is paused: no time-up line on any card until they say to start it again";

/**
 * Whether a Queue card is a briefing: it names a page for the owner to react to, which gets the longer default clock.
 *
 * @param row the card's Queue row
 * @returns true when the card carries at least one page
 */
export function triageCardIsBriefing({ row }: { row: QueueRow }): boolean {
  return row.card.pages.length > 0;
}

/**
 * The clock length for the card with `key`: the minutes the owner named, else the card's own default — ten minutes on
 * a briefing, two on any other card, and two on a card no longer on the Queue, which has no page left to react to.
 *
 * @param rows the Queue's rows as read now
 * @param key the card's key
 * @param minutes the length the owner named, `undefined` when they named none
 * @returns the length in milliseconds
 */
export function cardClockLengthMs({
  rows,
  key,
  minutes,
}: {
  rows: readonly QueueRow[];
  key: string;
  minutes: number | undefined;
}): number {
  const row = rows.find((one) => one.key === key);
  const briefing = row !== undefined && triageCardIsBriefing({ row });
  return triageClockLengthMs({ briefing, minutes });
}

/**
 * What the answer says when the owner's "Open cards and links" switch kept the card off their screen. The pass obeys the
 * switch exactly as `open_card` does — off, it opens nothing, even when asked (`docs/console/voice-opens-the-card.md`) —
 * so the voice says so instead of talking about a card the owner cannot see.
 */
const SWITCH_OFF_NOTE =
  "the owner's Open cards switch is off, so this card is not on their screen: read it to them, and say once in this pass that " +
  "'open cards' puts each card in front of them";

/**
 * Where the card's own opening stands, read off `open_card`'s answer: on the owner's screen only when it opened, and off
 * it by their switch only when the switch is what skipped it — a refused opening is off their screen too, but says so
 * in its own partial failure, never as the switch.
 *
 * @param answer the open's answer
 * @returns whether the card is on the owner's screen, and whether their switch is why not
 */
function cardScreen({ answer }: { answer: object }): {
  readonly onOwnerScreen: boolean;
  readonly switchedOff: boolean;
} {
  if (!("opened" in answer) || typeof answer.opened !== "object" || answer.opened === null) {
    return { onOwnerScreen: false, switchedOff: false };
  }
  const { opened } = answer;
  if (!("card" in opened) || typeof opened.card !== "object" || opened.card === null) {
    return { onOwnerScreen: false, switchedOff: false };
  }
  const { card } = opened;
  const outcome = "outcome" in card ? card.outcome : undefined;
  const why = "why" in card ? card.why : undefined;
  return { onOwnerScreen: outcome === "opened", switchedOff: outcome === "skipped" && why === SWITCHED_OFF };
}

/**
 * Run one `triage_next` call: begin the pass on the first call or once the last one is spent, pick a stopped one up
 * where it stopped — by `triage_end`, or by a reload (`../../lib/triageWalkKept.ts`) — pick the next card, put it in
 * front of the owner and start its clock, or, with every card seen, say the pass is done and stop the clock.
 *
 * @param seams what the call reaches
 * @param minutes the clock length the owner named for this card, already checked against their words; `undefined`
 *   when they named none, so the card's own default runs
 * @returns the card with where the pass stands, or the done answer
 */
export async function runTriageNext({
  seams,
  minutes,
}: {
  seams: TriageSeams;
  minutes: number | undefined;
}): Promise<OpenCardRan & { readonly triageVisit?: string }> {
  const nowMs = seams.triage.nowMs();
  let walk = seams.triage.read();
  const beginning = walk === undefined || triageWalkSpent({ nowMs, walk });
  // Triage is on only on the owner's word: a pass begins or is picked back up only when they asked, so "the next card"
  // outside one runs no clock. Decided before the Queue is read, and the page's pass is left
  // exactly as it was.
  if ((beginning || walk?.stoppedMs !== undefined) && !seams.triageAsked()) {
    seams.triage.stopClock();
    return {
      answer: { refused: TRIAGE_NOT_ASKED_REFUSAL },
      detail: "no triage pass: the owner has not asked to triage",
      partialFailures: [],
      readText: false,
      refused: true,
    };
  }
  // A count or "every card seen" over a source that never arrived names it, never reads as the whole Queue.
  // Every card read the call takes, the open's included, is tracked: an overlapping Queue call may replace the record
  // while the card opens, and a source unread at any read is named, never only the first's.
  const reads = trackedCardReads({ cards: seams.cards });
  const tracked = { ...seams, cards: reads.cards };
  const { focuses, rows: queueRows, unread } = tracked.cards();
  const rows = triageWalkRows({ focuses, rows: queueRows });
  // The pass's ordering basis: only the owner's focus switched on or off re-orders a pass under way.
  const focus = focuses.map((one) => one.queueWorkstream);
  // Spent before stopped, so a pass stopped past the idle window is never picked back up; the fresh one
  // still leaves out every card the owner ruled whose words have not changed.
  if (beginning || walk === undefined) {
    walk = startTriageWalk({ before: walk, focus, nowMs, rows, walkId: seams.triage.mintId() });
  } else if (walk.stoppedMs !== undefined) {
    walk = resumeTriageWalk({ walk });
  }
  const next = nextTriageCard({ focus, nowMs, rows, walk });
  seams.triage.write({ walk: next.walk });
  // The card it moved past keeps no clock, whatever becomes of this open.
  seams.triage.stopClock();
  if (next.pick === undefined) {
    const summary = triageSummary({ rows, walk: next.walk });
    const done = { done: true, note: "every card in this pass has been seen: say so, then call triage_end", summary };
    return {
      answer: withRecordUnread({ answer: done, capBytes: TOOL_OUTPUT_MAX, unread }),
      detail: `triage done, ${String(summary.seen)} of ${String(summary.of)} seen`,
      partialFailures: [],
      readText: false,
      refused: false,
    };
  }
  const { visit } = next.pick;
  const opened = await runOpenCard({ args: { key: visit.key }, seams: tracked });
  // Read again, not `next.walk`: a relay beside this call may have ruled the card before while this one opened.
  const latest = seams.triage.read();
  const answer = typeof opened.answer === "object" && opened.answer !== null ? opened.answer : {};
  // A card that left the owner's Queue while it opened resolves off `recentlyLeft`, read but marked removed.
  const leftAsItOpened = "removed" in answer;
  if (opened.refused || leftAsItOpened) {
    // Never in front of the owner, so never theirs to rule: it stays walked past rather than picked again
    // in a loop, and the card before keeps its reorder window.
    // A pass `triage_end` stopped while it opened is left exactly as it stopped.
    if (latest !== undefined && latest.stoppedMs === undefined && latest.current?.visitId === visit.visitId) {
      seams.triage.write({ walk: { ...latest, current: undefined } });
    }
    if (!leftAsItOpened) {
      return opened;
    }
    const note =
      "this card left the owner's Queue as it opened, so there is nothing to rule: call triage_next for the next";
    // The departure stands on the card reads too, so a source unread at any of them is named.
    return {
      ...opened,
      answer: withRecordUnread({ answer: { left: true, note }, capBytes: TOOL_OUTPUT_MAX, unread: reads.unreadSeen() }),
      detail: `triage: ${visit.key} left the owner's Queue as it opened`,
    };
  }
  let marked: TriageWalk | undefined;
  if (latest !== undefined) {
    marked = markTriageOpened({ visitId: visit.visitId, walk: latest });
    seams.triage.write({ walk: marked });
  }
  // One clock runs, the current card's: a second triage_next that moved past this card while it opened owns it now,
  // and starting this card's would cancel that one. A paused clock arms nothing, and nor does a
  // pass triage_end stopped while this card opened, which names no card to the server either.
  const paused = latest?.paused === true;
  const inFront = marked !== undefined && marked.stoppedMs === undefined && marked.current?.visitId === visit.visitId;
  const screen = cardScreen({ answer });
  const lengthMs = cardClockLengthMs({ key: visit.key, minutes, rows: queueRows });
  seams.triage.keepLength({ lengthMs, visitId: visit.visitId });
  if (triageClockOwed({ visitId: visit.visitId, walk: marked })) {
    seams.triage.startClock({ lengthMs, shown: screen.onOwnerScreen, visit });
  }
  const summary = triageSummary({ rows, walk: next.walk });
  const pass = {
    arrivedSincePassBegan: visit.arrived,
    // What relay_steer's triage_card names, so the owner's ruling lands on this card even once the next one is up.
    card: visit.key,
    clock: paused ? PAUSED_NOTE : clockNote({ lengthMs }),
    of: summary.of,
    outForRewrite: summary.outForRewrite,
    rewrittenAfterOwnerSentItBack: visit.rewritten,
    seen: summary.seen,
    onOwnerScreen: screen.onOwnerScreen,
    ...(screen.switchedOff ? { switchOff: SWITCH_OFF_NOTE } : {}),
  };
  let tag = "";
  if (visit.rewritten) {
    tag = ", rewritten";
  } else if (visit.arrived) {
    tag = ", arrived";
  }
  const ran = {
    ...opened,
    answer: withRecordUnread({
      answer: { ...answer, triage: pass },
      capBytes: TOOL_OUTPUT_MAX,
      unread: reads.unreadSeen(),
    }),
    detail: `triage ${String(summary.seen)}/${String(summary.of)}${tag}: ${opened.detail}`,
  };
  // Posted with the answer only while this card is the one in front of the owner, so the call times nothing else.
  return inFront ? { ...ran, triageVisit: visit.visitId } : ran;
}
