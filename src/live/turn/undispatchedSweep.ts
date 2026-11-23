/**
 * THE SWEEP'S SECOND ENTRANCE — what to say about an ask that has NO dispatch behind it at all.
 *
 * `./dispatch.ts` judges an ask a session picked up: a record, a lease, a screen to read. Everything here
 * judges the window BEFORE that, where a card or an `:eyes:` reaction is standing in a channel and no
 * routing decision was ever recorded. The two halves share a clock and nothing else — every finding in
 * `./dispatch.ts` keys on `activeDispatch` and returns early without one, which is exactly how the six-hour
 * card this module exists for stayed invisible — so they are separate modules rather than one file with two
 * entrances.
 *
 * One bound, {@link UNDISPATCHED_ABANDON_AFTER_MINUTES}, splits the window in two and both sides are
 * reported: {@link unroutedSweepNotice} below it, which settles nothing, and {@link undispatchedSweepAction}
 * above it, which calls the ask over. `./unroutedReport.ts` renders both, and `./inlineReviewHold.ts` is the
 * one thing that may HOLD the upper bound open past its own clock.
 *
 * Pure: a folded ask and an instant in, a finding out. No I/O, and the clock is injected, never read.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { AskLifecycle } from "../ask/lifecycle.js";

/**
 * The two fold states an ask sits in between being SEEN and being ROUTED — the whole window in which a card
 * is standing in a channel and no dispatch exists behind it.
 *
 * Deliberately not "anything with no `activeDispatch`": `lease-expired` and `dispatch-failed` also carry no
 * active dispatch, and both are already reported and finalised by the sweep's own arms. Widening this set
 * would re-terminalise an ask the sweep had just settled, on every subsequent lap.
 */
const UNROUTED_STATES: ReadonlySet<AskLifecycle["state"]> = new Set(["captured", "checklist-posted"]);

/**
 * How long an ask may sit captured-but-never-routed before the sweep calls it over.
 *
 * Thirty minutes, and it is measured rather than picked. Reproduce the number over any live home with:
 *
 * ```
 * jq -rs 'def secs: (.[0:19] + "Z") | fromdate;
 *   group_by(.channel + "/" + .messageTs)
 *   | map({cap: (map(select(.kind=="captured"))|first|.tsIso),
 *          out: (map(select(.kind|IN("dispatched","answered","withheld","failed","answer-lost","triaged-no-response")))|first|.tsIso)})
 *   | map(select(.cap != null and .out != null)) | map((.out|secs) - (.cap|secs))
 *   | "\(map(select(. <= 1800))|length)/\(length) within 30m"' \
 *   "$SLOPWEAVER_HOME/live/slack/asks.jsonl"
 * ```
 *
 * Measured over this install's 127 real asks: 120 of them (94.5%) reached a `dispatched` or a
 * terminal event within thirty minutes of capture. The seven that did not were overnight laps where no
 * visible session was running at all — for which "nothing has picked this up, re-tag" is the TRUE thing to
 * say, not a false one — and four of those were later dispatched and answered anyway, which stays possible:
 * `dispatch-failed` is explicitly re-dispatch-safe, so a loop that gets to one afterwards still answers it
 * and the card corrects forward. The asymmetry is the whole reason for a bound this tight: a card that says
 * "stopped, re-tag" over work that later lands costs a reader one stale glance, while the card this bound
 * exists to catch sat at "Work out how to answer" in a public channel for six hours.
 *
 * @internal
 */
export const UNDISPATCHED_ABANDON_AFTER_MINUTES = 30;

/**
 * A capture-time card standing over an ask no session ever routed — the sweep's sixth finding.
 *
 * @internal
 */
export interface UndispatchedAction {
  readonly ask: AskIdentity;
  readonly kind: "undispatched";
  readonly minutes: number;
  readonly reason: string;
}

/**
 * Decide whether one ask with NO active dispatch has been sitting unrouted long enough for the sweep to call
 * it over. Pure — the clock is injected, never read.
 *
 * This is the sweep's second entrance, and it exists because every other finding keys on `activeDispatch`
 * and returns early without it. MEASURED: a burst-queued follow-up was promoted and given the
 * full capture-time UX — `:eyes:` and a progress card — by `turn answer` running inside the PREVIOUS ask's
 * one-shot fresh-visible-session child, which printed the burst handoff line to its own stdout and then
 * exited. No dispatch was ever recorded, so `sweepDecision` never saw the ask at all, and the card sat on
 * `Work out how to answer` in a public channel for six hours while the message queued behind it was stranded
 * for good — only a terminal event drains a burst queue.
 *
 * A card is not required for this to fire. The `:eyes:` reaction goes up at CAPTURE, before any card, so an
 * ask that never reached `checklist-posted` still has an indicator standing that says "seen, working on it",
 * and leaving that is the same lie one step smaller.
 *
 * @param ask the folded ask, whose `activeDispatch`, `state` and last event decide this
 * @param nowIso the instant to judge the wait against
 * @returns what to finalise, or `undefined` while this ask is either routed, already settled, or still
 *   inside the window a session legitimately takes to route one
 */
export function undispatchedSweepAction({
  ask,
  nowIso,
}: {
  ask: AskLifecycle;
  nowIso: string;
}): UndispatchedAction | undefined {
  if (ask.activeDispatch !== undefined || !UNROUTED_STATES.has(ask.state)) {
    return undefined;
  }
  const lastEventAt = Date.parse(ask.lastEvent.tsIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(lastEventAt) || Number.isNaN(now)) {
    return undefined;
  }
  const minutes = Math.floor((now - lastEventAt) / 60_000);
  if (minutes < UNDISPATCHED_ABANDON_AFTER_MINUTES) {
    return undefined;
  }
  return {
    ask: { channel: ask.channel, messageTs: ask.messageTs, threadTs: ask.threadTs },
    kind: "undispatched",
    minutes,
    reason:
      `no session ever picked this up — it was seen ${String(minutes)}m ago (last event ` +
      `${ask.lastEvent.tsIso}) and no routing decision was ever recorded for it`,
  };
}

/**
 * An ask that is captured, carded and unrouted but NOT yet old enough to be called over — the sweep's
 * seventh finding, and the only one it reports without settling anything.
 *
 * @internal
 */
export interface UnroutedNotice {
  readonly ask: AskIdentity;
  readonly kind: "unrouted";
  readonly minutes: number;
  /** What was asked, when the ledger recorded it — absent on an ask captured before the field existed. */
  readonly text: string | undefined;
  readonly userId: string;
  readonly surface: "channel" | "dm";
}

/**
 * Notice an ask that has been sitting captured and unrouted for LESS time than
 * {@link UNDISPATCHED_ABANDON_AFTER_MINUTES}. Pure — the clock is injected, never read.
 *
 * This closes the blind window {@link undispatchedSweepAction}'s own bound creates. That arm fires at thirty
 * minutes, which is the right place to FINALISE a card — and it meant an ask a session should route right
 * now was invisible to the one instrument the loop runs on every idle tick. Measured: a burst
 * survivor was captured and carded, and the first thing any sweep said about it was the
 * never-dispatched finalisation half an hour later. Every sweep in between reported a clean board.
 *
 * It deliberately does NOT settle, count as a terminal, or touch a single indicator. The card is correct —
 * a session IS meant to be working this out — so the only thing wrong is that nobody has been told, and a
 * report is the whole fix.
 *
 * @param ask the folded ask, whose `activeDispatch`, `state` and last event decide this
 * @param nowIso the instant to judge the wait against
 * @returns the notice, or `undefined` when this ask is routed, settled, or already past the finalise bound
 *   (where {@link undispatchedSweepAction} owns it instead)
 */
export function unroutedSweepNotice({
  ask,
  nowIso,
}: {
  ask: AskLifecycle;
  nowIso: string;
}): UnroutedNotice | undefined {
  if (ask.activeDispatch !== undefined || !UNROUTED_STATES.has(ask.state)) {
    return undefined;
  }
  const lastEventAt = Date.parse(ask.lastEvent.tsIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(lastEventAt) || Number.isNaN(now)) {
    return undefined;
  }
  const minutes = Math.floor((now - lastEventAt) / 60_000);
  if (minutes >= UNDISPATCHED_ABANDON_AFTER_MINUTES) {
    return undefined;
  }
  return {
    ask: { channel: ask.channel, messageTs: ask.messageTs, threadTs: ask.threadTs },
    kind: "unrouted",
    minutes,
    surface: ask.surface,
    text: ask.text,
    userId: ask.userId,
  };
}
