/**
 * Finalising the live indicators of an ask NOBODY is coming back for.
 *
 * The sweep's half of `../../../live/turn/indicators.ts`. A turn's own terminal path finalises its own
 * indicators from inside `runTurn`; this is what happens when there is no inside left — a dispatched session
 * died, never reported, or ran past its lease, and the card, the native status and the `:eyes:` reaction it
 * raised are all still standing with nothing behind them.
 *
 * Split out of `./dispatch.ts` only because that file is at its line cap; it is the same one seam, called by
 * the sweep's `lease-expired` branch, its `phantom` branch and its `worker-failed` branch. The recording
 * itself — the durable event and the indicator finalisation — lives in `./sweptRecords.ts`; this file decides
 * which finding an ask earned and prints the sweep's line for it.
 *
 * ## Four ways to find a turn over, one finalisation
 *
 * A lease that ran out and a workspace that holds no session are the same thing to the person waiting in the
 * thread — a card still ticking with nothing behind it — so both land through `finaliseSweptAsk`
 * and both leave `abandoned` indicators. They differ in what the ledger records and in what the reason SAYS,
 * and the reason is the part a reader acts on: a lease names a timeout, a phantom names the workspace cmux
 * could not find a session in.
 *
 * The third is different in kind and is kept so on the card: a worker that REPORTED its own failure
 * (`turn resume --failed`, or an answer that would not validate) is a turn that ran and said why it stopped,
 * so it lands as `failed` — "this turn failed — <the worker's reason>" — never as `abandoned`, which would
 * tell the reader nobody came back when somebody did. That is the loop's half of the worker contract: the
 * worker reports its terminal outcome in its own words, and the sweep makes the thread say it.
 *
 * The fourth, `recordUndispatchedAsk`, is the odd one: an ask with no `dispatched` event AT ALL, whose
 * capture-time reaction and card were the only things ever raised for it. Nothing here can read a tier off a
 * dispatch that does not exist, which is why `finaliseSweptAsk` takes its checklist steps as an
 * argument rather than deriving them.
 *
 * ## The fifth way is to find a turn NOT over, and it belongs in the same function
 *
 * An ask with no `dispatched` event is not the same thing as an ask nobody is inside. An INLINE turn records
 * no dispatch at all unless `../dispatch.ts`'s `handleInline` ran, so the fourth way above reads a turn a
 * session is actively composing and reviewing as one nobody ever picked up. Measured: it
 * finalised a card fifteen minutes before that turn's own answer posted. So {@link settleUndispatched} asks
 * `../../../live/turn/inlineReviewHold.ts` first, and an open review HOLDS every arm of this file off the
 * ask — no event, no indicator, no reviewer reaped.
 */

import { askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycle, DispatchedEvent } from "../../../live/ask/lifecycle.js";
import type { TerminalSweepAction } from "../../../live/turn/dispatch.js";
import { inlineReviewHold } from "../../../live/turn/inlineReviewHold.js";
import type { ReviewPosture } from "../../../live/turn/leaseJudgement.js";
import { undispatchedSweepAction, unroutedSweepNotice } from "../../../live/turn/undispatchedSweep.js";
import {
  inReviewLine,
  neverDispatchedLine,
  type UnroutedSubject,
  unroutedLine,
} from "../../../live/turn/unroutedReport.js";
import { reapAskReviewer } from "./reviewReap.js";
import {
  recordFollowThroughStopped,
  recordLeaseExpiry,
  recordPhantomDispatch,
  recordUndispatchedAsk,
  recordWorkerFailure,
} from "./sweptRecords.js";

/**
 * What the sweep knows about one unrouted ask, in the shape both of its lines are composed from.
 *
 * @param entry the ask being swept
 * @returns the ask's identity, asker, surface and recorded question
 */
function unroutedSubjectOf({ entry }: { entry: AskLifecycle }): UnroutedSubject {
  return {
    ask: askIdentityOf({ source: entry }),
    surface: entry.surface,
    text: entry.text,
    userId: entry.userId,
  };
}

/**
 * Report one ask with no dispatch behind it — hold it while its review is open, and otherwise, once it is
 * old enough, finalise it. The sweep's sixth, seventh and eighth findings, which are one function because
 * they are three readings of one situation.
 *
 * Kept beside {@link settleSweptTerminal} rather than inside it because it shares neither of that function's
 * two inputs: there is no `DispatchedEvent` to read a tier from, and no reviewer to REAP — an ask held here
 * has one open, which is the whole reason it is held, and reaping it is precisely what must not happen.
 *
 * The `unrouted` half SETTLES NOTHING. Its whole content is that a card is standing and nobody has routed
 * the ask under it — which is a perfectly correct state for a minute or two and an emergency at twenty, and
 * the sweep says both. See
 * `../../../live/turn/undispatchedSweep.ts#unroutedSweepNotice`.
 *
 * **The hold is checked FIRST, and it displaces both other arms rather than only the finalisation.** An
 * inline turn under review has a session inside it, so `UNROUTED — ROUTE IT NOW` is as wrong about it as
 * `NEVER-DISPATCHED` is: the measured incident printed that line at a turn being actively worked on every
 * lap for thirty-three minutes before finalising its card, and a reader who acted on either would have
 * posted a second card over the one the person was watching.
 * `../../../live/turn/inlineReviewHold.ts` carries the measurement and the half of the class it does not
 * close.
 *
 * @param entry the ask being swept
 * @param home the resolved state home
 * @param nowIso the instant the wait is judged against
 * @param onInReview counts the held finding for the sweep's summary line
 * @param onUndispatched counts the finalised finding for the sweep's summary line
 * @param onUnrouted counts the still-routable finding for the sweep's summary line
 * @param review what this ask's review looks like on disk right now
 * @param writeLine the sweep's own output channel
 */
export async function settleUndispatched({
  entry,
  home,
  nowIso,
  onInReview,
  onUndispatched,
  onUnrouted,
  review,
  writeLine,
}: {
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  onInReview: () => void;
  onUndispatched: () => void;
  onUnrouted: () => void;
  review: ReviewPosture;
  writeLine: (input: { line: string }) => void;
}): Promise<void> {
  const notice = unroutedSweepNotice({ ask: entry, nowIso });
  const action = undispatchedSweepAction({ ask: entry, nowIso });
  // Both arms are pure and neither settles anything, so calling them before the hold is free — and it is
  // what gives the held line the same elapsed count the other two print, whichever side of the bound the
  // ask is on. They partition on one predicate, so at most one is ever defined; neither being defined means
  // this ask is routed or already settled and no arm of this function has anything to say about it.
  let elapsed: number;
  if (notice !== undefined) {
    elapsed = notice.minutes;
  } else if (action !== undefined) {
    elapsed = action.minutes;
  } else {
    return;
  }
  const hold = inlineReviewHold({ nowIso, review });
  if (hold !== undefined) {
    writeLine({
      line: inReviewLine({
        because: hold.because,
        minutes: elapsed,
        spawnedAt: hold.spawnedAt,
        subject: unroutedSubjectOf({ entry }),
      }),
    });
    onInReview();
    return;
  }
  if (notice !== undefined) {
    writeLine({ line: unroutedLine({ minutes: notice.minutes, subject: unroutedSubjectOf({ entry }) }) });
    onUnrouted();
    return;
  }
  if (action === undefined) {
    return;
  }
  await recordUndispatchedAsk({ entry, home, nowIso, reason: action.reason });
  writeLine({ line: neverDispatchedLine({ reason: action.reason, subject: unroutedSubjectOf({ entry }) }) });
  onUndispatched();
}

/**
 * Record and finalise one of the sweep's three terminal findings — the worker's own failure report, a lease
 * that ran out, or a workspace holding no session — and write its line. Each arm is the same two halves: the
 * durable lifecycle event above, then the thread's indicators told the truth.
 *
 * The action type is `TerminalSweepAction`, narrowed by `terminalSweepAction` at the one call site, so a
 * non-terminal arm cannot reach the reviewer release below by type. That is not decoration: `lease-held`
 * used to reach it, and its whole meaning is that a reviewer is mid-verdict —
 * `../../../live/turn/dispatch.ts#terminalSweepAction` carries the measurement.
 *
 * @param action the terminal finding, already narrowed
 * @param dispatched the ask's own last `dispatched` event
 * @param entry the ask being swept
 * @param home the resolved state home
 * @param nowIso the instant this finding was reached
 * @param writeLine the sweep's own output channel
 */
export async function settleSweptTerminal({
  action,
  counters,
  dispatched,
  entry,
  home,
  nowIso,
  writeLine,
}: {
  action: TerminalSweepAction;
  counters: { readonly onExpired: () => void; readonly onFailed: () => void; readonly onPhantom: () => void };
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  writeLine: (input: { line: string }) => void;
}): Promise<void> {
  const ask = `${entry.channel}/${entry.messageTs}`;
  // Every arm below is TERMINAL for the ask, so every one of them owes its reviewer a release: nothing can
  // consume a verdict for an ask the sweep has just finalised, and the worker that was supposed to run
  // `turn review --close` is by definition not coming back. `./reviewReap.ts` never throws.
  await reapAskReviewer({ askIdentity: entry, home, terminal: action.kind });
  if (action.kind === "worker-failed") {
    await recordWorkerFailure({ dispatched, entry, home, nowIso, reason: action.reason });
    writeLine({ line: `worker-failed (finalised, stranded — one re-dispatch pending): ${ask} — ${action.reason}` });
    counters.onFailed();
    return;
  }
  const firstAnswerIso = entry.firstAnswer?.tsIso;
  if (action.kind === "lease-expired") {
    await recordLeaseExpiry({ dispatched, entry, home, nowIso });
    const posted = firstAnswerIso === undefined ? "" : `, first answer posted ${firstAnswerIso}`;
    writeLine({ line: `lease-expired (re-judgement candidate${posted}): ${ask}` });
    counters.onExpired();
    return;
  }
  if (firstAnswerIso !== undefined) {
    await recordFollowThroughStopped({ dispatched, entry, firstAnswerIso, home, nowIso });
    writeLine({
      line: `phantom (nothing running, re-dispatch candidate): ${ask} — ${action.reason} after its first answer ${firstAnswerIso}`,
    });
    counters.onPhantom();
    return;
  }
  await recordPhantomDispatch({ dispatched, entry, home, nowIso, reason: action.reason });
  writeLine({ line: `phantom (nothing running, re-dispatch candidate): ${ask} — ${action.reason}` });
  counters.onPhantom();
}
