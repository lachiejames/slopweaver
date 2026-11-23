/**
 * The sweep's recording half — one durable lifecycle event per ask it found over, then every live indicator
 * the ask raised told the truth.
 *
 * Split out of `./abandoned.ts`, which keeps the DECISION of which finding an ask earned and the line the
 * sweep prints for it. Every function here is the same two halves: append the event a later sweep and any
 * board reader see, then finalise the card, the native status and the reaction through
 * {@link finaliseSweptAsk}, which the person waiting in the thread sees. Recording only the first is the
 * defect this whole family exists to remove — a ledger that knows and a thread that does not.
 */

import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { slackBotToken } from "../../../config.js";
import { makeSlackWriteTransport } from "../../../corpus/slack/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycle, AskLifecycleEvent, DispatchedEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import { PENDING_ROUTE_STEPS, turnStepsForTier } from "../../../live/turn/answer.js";
import { dispatchIdOf } from "../../../live/turn/dispatch.js";
import { finaliseIndicators, type TurnTerminalState } from "../../../live/turn/indicators.js";
import { liveIndicatorSeams } from "../../../live/turn/poster.js";
import { FOLLOW_THROUGH_STOPPED_FINDING, recoveryCardReason } from "../../../live/turn/recoveryWording.js";
import { effectiveLeaseExpiresAt } from "../../../live/turn/tier.js";
import { supervisorModelLabel } from "../../../supervisor/session.js";
import { chromeFromProfile, turnChromeFrom } from "../slack/wiring.js";

/**
 * Finalise every indicator of an ask the sweep found over — abandoned, or failed by its own report — through
 * the SAME seam a turn's own terminal path uses.
 *
 * Best-effort in every direction, and deliberately so: no bot token, no checklist ref, no readable state at
 * all means the sweep still records the expiry and moves on. What it must never do is throw — a single
 * unfinishable ask must not abort the rest of the sweep, which is the same rule `attemptChecklistAdvance`
 * already holds to for the courtesy update.
 *
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @param state how the turn ended and what the card is told, in words a reader can act on
 * @param steps the checklist frame the standing card was drawn with — its tier's own steps for a dispatched
 *   ask, and `PENDING_ROUTE_STEPS` for one nothing ever routed, so the reason lands on a step the card has
 * @param report where an unsettled indicator is named — one line per indicator, never a throw
 */
async function finaliseSweptAsk({
  entry,
  home,
  state,
  steps,
  report,
}: {
  entry: AskLifecycle;
  home: string;
  state: TurnTerminalState;
  steps: readonly { readonly id: string; readonly title: string }[];
  report: (input: { ask: AskLifecycle; failure: string }) => void;
}): Promise<void> {
  const botToken = slackBotToken({ home });
  if (botToken === undefined) {
    report({ ask: entry, failure: "could not finalise its indicators — no Slack bot token is configured" });
    return;
  }
  const started = entry.started;
  const chrome = chromeFromProfile({ home });
  // `explicit` rather than a model host: nothing is behind this write but the sweep itself, and stamping a
  // model that never ran would put a false provenance line on the very card being corrected for lying.
  const supervisor = { host: "explicit" as const, id: "turn dispatch --sweep" };
  const finalisation = await finaliseIndicators({
    seams: liveIndicatorSeams({
      askIdentity: entry,
      doorLedger: doorLedgerPort(),
      home,
      ...(started === undefined ? {} : { posted: { channel: entry.channel, ts: started.workingTs } }),
      provenance: { modelId: supervisorModelLabel({ session: supervisor }), supervisor },
      steps,
      task: "answering",
      transport: makeSlackWriteTransport({ home, token: botToken }),
      turnChrome: turnChromeFrom({ chrome }),
      turnId: started === undefined ? dispatchIdOf({ askIdentity: entry }) : started.turnId,
    }),
    state,
  });
  const failures = finalisation.checklistSettled
    ? finalisation.failures
    : [...finalisation.failures, "the working checklist could not be settled — it may still show unfinished steps"];
  for (const failure of failures) {
    report({ ask: entry, failure });
  }
}

/** The sweep's own reporter — one stderr line per indicator it could not settle, never a throw. */
function sweepReporter(): (input: { ask: AskLifecycle; failure: string }) => void {
  return ({ ask, failure }) => {
    logger.error({ msg: `turn dispatch --sweep: ${ask.channel}/${ask.messageTs} — ${failure}` });
  };
}

/**
 * Record that a dispatched ask's lease ran out, and leave every indicator it raised telling the truth.
 *
 * The two halves belong together and are one call for that reason: the durable `lease-expired` event is what
 * a later sweep and `handover`-style reader see, and the indicator finalisation is what the person waiting in
 * the thread sees. Recording only the first is what the sweep did before this existed — the ledger knew the
 * session was gone while the thread went on showing a half-ticked card, a `:eyes:` reaction and, inside its
 * two-minute window, a live thinking indicator.
 *
 * @param dispatched the ask's own last `dispatched` event, carrying the lease it ran past
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @param nowIso the current instant
 */
export async function recordLeaseExpiry({
  dispatched,
  entry,
  home,
  nowIso,
}: {
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
}): Promise<void> {
  appendAskLifecycleEvent({
    event: { ...askIdentityOf({ source: entry }), kind: "lease-expired", tsIso: nowIso },
    home,
  });
  const leaseExpiresAt = effectiveLeaseExpiresAt({ activeDispatch: dispatched, firstAnswer: entry.firstAnswer });
  const firstAnswer = entry.firstAnswer;
  if (firstAnswer !== undefined) {
    // A plan stands in the thread, so the card says so rather than that nobody came back.
    const reason = recoveryCardReason({ context: "follow-through-stopped", reason: FOLLOW_THROUGH_STOPPED_FINDING });
    await finaliseSweptAsk({
      entry,
      home,
      report: sweepReporter(),
      steps: turnStepsForTier({ tier: dispatched.tier }),
      state: {
        kind: "abandoned",
        readerReason: reason,
        reason:
          `the session building the follow-through ran out of time — first answer posted ${firstAnswer.tsIso}, ` +
          `lease ran out at ${leaseExpiresAt} (now ${nowIso})`,
      },
    });
    return;
  }
  const reason = recoveryCardReason({
    context: "lease-ran-out",
    reason: `the session it was handed to never came back — its lease ran out at ${leaseExpiresAt} (now ${nowIso})`,
  });
  await finaliseSweptAsk({
    entry,
    home,
    report: sweepReporter(),
    steps: turnStepsForTier({ tier: dispatched.tier }),
    // The sweep composes this sentence itself, from a timestamp and a template — already colleague-safe, so
    // both fields carry it.
    state: { kind: "abandoned", readerReason: reason, reason },
  });
}

/**
 * Record that a worker which already posted its FIRST answer holds no session any more, and leave every
 * indicator telling the truth — the `phantom` arm for an ask whose plan stands in the thread.
 *
 * The event is `failed`, never `dispatch-failed`: `dispatch-failed` means NOTHING RAN (its own header in
 * `../../../live/ask/lifecycleEvents.ts`), and a plan ran and was posted. `failed` is a stranded state, so the
 * recovery pass picks the ask up exactly once and announces it with the plan-posted notice
 * (`../../../live/listen/stranded.ts`).
 *
 * @param dispatched the ask's own last `dispatched` event, for the tier its checklist steps come from
 * @param entry the ask this dispatch is for
 * @param firstAnswerIso when the first answer was posted
 * @param home the resolved state home
 * @param nowIso the current instant
 */
export async function recordFollowThroughStopped({
  dispatched,
  entry,
  firstAnswerIso,
  home,
  nowIso,
}: {
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  firstAnswerIso: string;
  home: string;
  nowIso: string;
}): Promise<void> {
  const reason = `the worker's workspace is gone after it posted its first answer at ${firstAnswerIso}`;
  appendAskLifecycleEvent({
    event: { ...askIdentityOf({ source: entry }), kind: "failed", reason, tsIso: nowIso },
    home,
  });
  await finaliseSweptAsk({
    entry,
    home,
    report: sweepReporter(),
    steps: turnStepsForTier({ tier: dispatched.tier }),
    state: {
      kind: "failed",
      readerReason: recoveryCardReason({ context: "follow-through-stopped", reason: FOLLOW_THROUGH_STOPPED_FINDING }),
      reason: recoveryCardReason({ context: "follow-through-stopped", reason }),
    },
  });
}

/**
 * Record that a dispatched ask holds no session at all, and leave every indicator it raised telling the truth.
 *
 * The `dispatch-failed` twin of {@link recordLeaseExpiry}, and deliberately the same two-halves shape: the
 * durable event is what a later sweep and any board reader see, and the finalisation is what the person
 * waiting in the thread sees. Recording only the first would leave the exact defect this whole change exists
 * to remove, just one layer down — a ledger that knows and a thread that does not.
 *
 * @param dispatched the ask's own last `dispatched` event, for the tier its checklist steps come from
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param reason what the liveness check found, verbatim
 */
export async function recordPhantomDispatch({
  dispatched,
  entry,
  home,
  nowIso,
  reason,
}: {
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  reason: string;
}): Promise<void> {
  appendAskLifecycleEvent({
    event: { ...askIdentityOf({ source: entry }), kind: "dispatch-failed", reason, tsIso: nowIso },
    home,
  });
  // `reason` here is the liveness check's own finding — a workspace/session lookup result the sweep
  // produced itself, already colleague-safe, so both fields carry the same composed sentence.
  const cardReason = recoveryCardReason({ context: "nothing-ran", reason });
  await finaliseSweptAsk({
    entry,
    home,
    report: sweepReporter(),
    steps: turnStepsForTier({ tier: dispatched.tier }),
    state: { kind: "abandoned", readerReason: cardReason, reason: cardReason },
  });
}

/**
 * Record that an ask NOBODY EVER ROUTED is over, and leave every indicator its capture raised telling the
 * truth — the fourth arm, and the only one that finalises an ask with no `dispatched` event behind it at all.
 *
 * The same two halves as {@link recordLeaseExpiry}, with two differences that are the point.
 *
 * The card was drawn at CAPTURE, before routing knew anything, so it wears `PENDING_ROUTE_STEPS` rather than
 * any tier's own list — settling it against a tier list would write the reason onto a step index the standing
 * card does not have. `./triagedIndicators.ts` makes the same choice for the same reason.
 *
 * And the durable event is `dispatch-failed` rather than `failed`. Nothing ran, which is exactly what that
 * event means and exactly what makes re-dispatching this ask safe if a session gets to it later; `failed`
 * would claim a turn ran and reported its own break, and none did. Being a slot release
 * (`../../../live/ask/burst.ts#burstSlotRelease`) it also DRAINS whatever was queued behind this ask, which
 * is the half the incident needed most: a follow-up queued behind an ask that never reaches another event
 * waits forever, and one had been waiting seventeen hours when this was written.
 *
 * @param entry the ask this card was raised for
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param reason what the sweep found, verbatim — already colleague-safe, so it carries both fields
 */
export async function recordUndispatchedAsk({
  entry,
  home,
  nowIso,
  reason,
}: {
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  reason: string;
}): Promise<void> {
  const failed: AskLifecycleEvent = {
    ...askIdentityOf({ source: entry }),
    kind: "dispatch-failed",
    reason,
    tsIso: nowIso,
  };
  appendAskLifecycleEvent({ event: failed, home });
  const cardReason = recoveryCardReason({ context: "never-routed", reason });
  await finaliseSweptAsk({
    entry,
    home,
    report: sweepReporter(),
    state: { kind: "abandoned", readerReason: cardReason, reason: cardReason },
    steps: PENDING_ROUTE_STEPS,
  });
}

/**
 * Record that a dispatched worker reported its own failure, and leave every indicator it raised telling the
 * truth — the loop's half of the worker contract.
 *
 * The same two-halves shape as {@link recordLeaseExpiry}, with two differences that are the point. The
 * lifecycle event is `failed`, a TERMINAL: the worker ran and said no answer is coming, so the ask is not a
 * re-judgement candidate the way a lease expiry is — a re-tag starts a fresh one. And because `failed` is
 * terminal, whatever was queued behind this ask in a burst is drained here exactly as `turn answer`'s own
 * `failed` path drains it (`../listen/burstSurface.ts`) — measured, a follow-up left queued behind a
 * terminal ask with no further event to fire on waited silently forever.
 *
 * @param dispatched the ask's own last `dispatched` event, for the tier its checklist steps come from
 * @param entry the ask this dispatch is for
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param reason the worker's own reason, verbatim
 */
export async function recordWorkerFailure({
  dispatched,
  entry,
  home,
  nowIso,
  reason,
}: {
  dispatched: DispatchedEvent;
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  reason: string;
}): Promise<void> {
  const failed: AskLifecycleEvent = { ...askIdentityOf({ source: entry }), kind: "failed", reason, tsIso: nowIso };
  appendAskLifecycleEvent({ event: failed, home });
  await finaliseSweptAsk({
    entry,
    home,
    report: sweepReporter(),
    steps: turnStepsForTier({ tier: dispatched.tier }),
    state: {
      kind: "failed",
      // `reason` is the WORKER's own words — written for the next session to read, per `./abandoned.ts`'s own
      // header, never for the channel. The card gets a generic, colleague-safe sentence instead; `reason`
      // (the worker's verbatim report) still reaches the ledger event above and the journal.
      readerReason: recoveryCardReason({
        context: "worker-stopped",
        reason: "the session working on this reported it could not finish",
      }),
      reason: recoveryCardReason({ context: "worker-stopped", reason }),
    },
  });
}
