/**
 * What the progress card SAYS when the just-in-time gate decides to WAIT.
 *
 * ## Why the card has to say it at all
 *
 * The gate (`../../retrieval/justInTime.ts`) buys correctness by making a recency-sensitive question wait
 * for its sources to catch up. Slack's floor is seventeen and a half minutes, so that is bought with the
 * one thing the reader notices most: silence. The owner's ruling is that the silence is fine as long as the
 * card explains it: the card says the question needs fresh data and a refresh is running, which keeps the UX
 * good enough while staying true to the correctness-over-speed principle.
 *
 * So a wait with no card line is not a slower answer, it is a broken-looking bot. These lines are what the
 * visible session posts through `slopweaver turn status` before it starts waiting; each becomes one stage
 * on the card and stays there (`./progressLog.ts`), which is why the wait is still legible in the finished
 * card after the answer lands.
 *
 * ## Two lines, and why the second is not optional
 *
 * The first line is the wait and its estimate. The second is the gate's own hole, stated to the reader
 * rather than left in a source file: the gate waits only on sources THIS question's retrieval draws on, and
 * a source that is behind and would have contributed had it been fresh is invisible to retrieval, because
 * retrieval cannot rank records that are not there. A reader who is told "refreshing before I answer" and
 * not told that will read the answer as complete. The scheduled slot is what bounds that hole; this card is
 * where the reader learns it exists.
 *
 * Pure and clock-injected, like `./progressCard.ts` beside it — every line is assertable with no Slack, no
 * filesystem and no refresh running anywhere near it.
 */

import type { InFlightRefresh } from "../../corpus/refreshSlot.js";
import type { JustInTimeVerdict, JustInTimeWait } from "../../retrieval/justInTime.js";
import { CARD_LINE_CAP, clampVisible } from "./answer.js";
import { elapsedWords } from "./progressCard.js";

/**
 * The gate's hole, in the reader's words. Fixed text: it is a property of the test rather than of a run, so
 * a line composed per-verdict would vary without saying anything different.
 */
const HOLE_LINE =
  "only sources this question reads were refreshed — one that is behind and contributed nothing is invisible here";

/**
 * The stage lines a turn posts when the gate says WAIT — the wait itself, then the gate's own hole.
 *
 * An `answer-now` verdict produces NO lines. A card line per non-event is the wall of text doctrine rule 7
 * bans, and "nothing was stale" is already carried by the coverage receipt that rides with every answer.
 *
 * @param verdict the gate's verdict for this question
 * @param nowIso the instant the card is being written, for ageing an in-flight refresh
 * @returns the lines to post as stages, in order, each within {@link CARD_LINE_CAP}
 */
export function justInTimeCardLines({
  verdict,
  nowIso,
}: {
  verdict: JustInTimeVerdict;
  nowIso: string;
}): readonly string[] {
  if (verdict.decision === "answer-now") {
    return [];
  }
  return [
    clampVisible({ cap: CARD_LINE_CAP, text: waitLine({ nowIso, wait: verdict }) }),
    clampVisible({ cap: CARD_LINE_CAP, text: HOLE_LINE }),
  ];
}

/**
 * The wait line: which sources are behind, how far, and how long catching them up is expected to take.
 *
 * When a refresh for one of those sources is ALREADY running, the line NAMES that source rather than
 * announcing a second run — two turns asking about the same afternoon must not start two Slack backfills,
 * and a reader told "refreshing before I answer" while another run is mid-flight is being told something
 * false. It names the running source specifically, never the whole waited-on list, because on a two-source
 * wait only one of them may be in flight.
 */
function waitLine({ nowIso, wait }: { nowIso: string; wait: JustInTimeWait }): string {
  const behind = wait.waitOn.map(({ behindMinutes, source }) => `${source} (${behindWords({ behindMinutes })})`);
  const subject = `this question needs ${behind.join(", ")} up to date`;
  if (wait.alreadyRunning.length === 0) {
    return `${subject} — refreshing before I answer, ${wait.estimate.words}`;
  }
  const names = wait.alreadyRunning.map(({ source }) => source).join(", ");
  // The elapsed clause rides ONLY on a single-source wait. With several, one holder's start says nothing
  // useful about when the whole wait ends, and the line has to stay inside the card's width — the pid and
  // the exact start are on the refusal the freshness gate prints, where a reader can go and look.
  const since = wait.waitOn.length === 1 ? sinceClause({ nowIso, running: wait.alreadyRunning }) : "";
  return `${subject} — ${names} already refreshing${since}, ${wait.estimate.words}`;
}

/** How long an in-flight refresh has been going, as a clause, or nothing when its start will not parse. */
function sinceClause({ nowIso, running }: { nowIso: string; running: readonly InFlightRefresh[] }): string {
  const first = running[0];
  const ago = first === undefined ? undefined : elapsedWords({ fromIso: first.startedAtIso, toIso: nowIso });
  if (ago === undefined) {
    return "";
  }
  return ago === "just now" ? " (started just now)" : ` (started ${ago} ago)`;
}

/**
 * How far behind a source is, in the coarsest unit that is still true — whole hours past an hour, whole
 * minutes below one. A reader deciding whether to keep waiting does not need a second decimal place, and
 * `17.4h` reads like an instrument rather than an explanation.
 */
function behindWords({ behindMinutes }: { behindMinutes: number }): string {
  const minutes = Math.round(behindMinutes);
  if (minutes < 60) {
    return `${String(minutes)}m behind`;
  }
  return `${String(Math.round(minutes / 60))}h behind`;
}
