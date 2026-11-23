/**
 * What the `fresh-visible-session` tier RECORDS — every durable write that outlives the dispatch call, and
 * the two judgements a later reader depends on those writes being honest about.
 *
 * Split out of `./dispatchFreshSession.ts` along the seam that file really has: LAUNCHING a worker is one
 * act with one failure mode, while what is written down about it is read back by `turn dispatch --poll`,
 * `--sweep`, `turn resume` and the board, days later and by other sessions. The ordering rules that make
 * those reads safe — a `dispatch-failed` before any retry is possible, an `unwitnessed` that deliberately
 * settles nothing — live with the writes rather than beside the subprocess call that triggered them.
 *
 * Depth 1 — the stores and the lifecycle log, and nothing this verb owns.
 */
import type { WorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import type { VisibleSessionPlan } from "../../../cmux/plan.js";
import type { AskIdentity } from "../../../live/ask/identity.js";
import {
  type AskLifecycle,
  type AskLifecycleEvent,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
} from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent, readAskLifecycleText } from "../../../live/ask/store.js";
import { FRESH_DISPATCH_SCHEMA_VERSION } from "../../../live/turn/dispatch.js";
import { writeDispatchRecord } from "../../../live/turn/dispatchStore.js";
import type { RoutingJudgementInput } from "../../../live/turn/judgement.js";
import { registerDispatchedSession } from "../../../live/turn/sessionLedger.js";
import { type FreshVisibleSessionRef, type RespondDecision } from "../../../live/turn/tier.js";
import { recordPhantomDispatch } from "./sweptRecords.js";

/**
 * Record a successful fresh-session dispatch: the supervisor's own session-ledger entry — keyed by the same name
 * `claude --name` gave this worker — then the lifecycle event and the durable locator record.
 */
export function recordFreshDispatch({
  askIdentity,
  askPermalink,
  briefPath,
  decision,
  dispatchId,
  home,
  leaseExpiresAt,
  plan,
  routingInput,
  session,
}: {
  askIdentity: AskIdentity;
  askPermalink: string;
  briefPath: string;
  decision: RespondDecision;
  dispatchId: string;
  home: string;
  leaseExpiresAt: string;
  plan: VisibleSessionPlan;
  routingInput: RoutingJudgementInput;
  session: FreshVisibleSessionRef;
}): void {
  // The ledger row FIRST: the session is already standing, so a write below that throws must not leave it unseen.
  registerDispatchedSession({
    home,
    plan,
    surfaceRef: session.surfaceRef,
    workspaceId: session.workspaceId,
    workspaceRef: session.workspaceRef,
  });
  appendAskLifecycleEvent({
    event: {
      ...askIdentity,
      decision,
      kind: "dispatched",
      leaseExpiresAt,
      tier: "fresh-visible-session",
      tsIso: new Date().toISOString(),
    },
    home,
  });
  writeDispatchRecord({
    home,
    record: {
      ...askIdentity,
      askPermalink,
      briefPath,
      decision,
      dispatchId,
      execution: routingInput.execution,
      leaseExpiresAt,
      schemaVersion: FRESH_DISPATCH_SCHEMA_VERSION,
      session,
    },
  });
}

/**
 * This ask's own folded lifecycle entry, or `undefined` when the log carries none for it.
 *
 * @param askIdentity the ask to look up
 * @param home the resolved state home
 * @returns the folded entry
 */
function foldedAskEntry({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): AskLifecycle | undefined {
  const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
  return folded.get(askLifecycleKey({ askIdentity }));
}

/**
 * Record that a `dispatched` event this call just wrote was never true of anything, and unblock whatever was
 * queued behind the ask.
 *
 * Called when the spawn genuinely did not land: a pickup command the client REFUSED to send, and a liveness
 * check that finds no session in the workspace the record names. A pickup that was sent and merely went
 * unwitnessed is NOT this — that is {@link recordDispatchUnwitnessed}, and routing it here is the measured
 * defect both functions' docs describe. It appends `dispatch-failed`
 * through {@link recordPhantomDispatch} — the same seam the sweep's own phantom branch uses, so the ledger
 * entry and the corrected card are identical whichever side notices first — then drains the burst queue
 * through the one shared entrance, because the ask is no longer active and a later tag of the asker's must
 * stop waiting on it (`../../../live/ask/burst.ts#burstSlotRelease` is what decides that, not this function).
 *
 * When the fold carries no `dispatched` event for this ask (a log that could not be read back, which is not
 * a reason to leave the ask sitting at `dispatched`), the durable event is still appended on its own. That
 * is the half that must never be skipped; the indicator finalisation needs a checklist ref the fold is the
 * only source of.
 *
 * Exported for the regression test that drives the whole recording half against a real temp home — the
 * `dispatched` → `dispatch-failed` transition and the burst-queue release, with no cmux and no Slack
 * anywhere near it.
 *
 * @param askIdentity the ask whose dispatch never landed
 * @param home the resolved state home
 * @param reason what did not land, in words a reader can act on
 */
export async function recordDispatchNeverLanded({
  askIdentity,
  home,
  reason,
}: {
  askIdentity: AskIdentity;
  home: string;
  reason: string;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const failed: AskLifecycleEvent = { ...askIdentity, kind: "dispatch-failed", reason, tsIso: nowIso };
  const entry = foldedAskEntry({ askIdentity, home });
  if (entry?.lastEvent.kind !== "dispatched") {
    appendAskLifecycleEvent({ event: failed, home });
  } else {
    await recordPhantomDispatch({ dispatched: entry.lastEvent, entry, home, nowIso, reason });
  }
}

/**
 * Record that a just-dispatched pickup was SENT and nothing witnessed it arriving — the third answer, and the
 * one this path had no way to give.
 *
 * Deliberately three things it does NOT do, each of which {@link recordDispatchNeverLanded} does and each of
 * which was a measured defect when applied here (measured on one ask):
 *
 *  - **It does not end the dispatch.** `dispatch-unwitnessed` is in `supersedesDispatch`'s preserving set, so
 *    `activeDispatch` survives and `turn dispatch --sweep` goes on tracking the worker exactly like a running
 *    one. Under `dispatch-failed` the sweep reported `0 working` over a live session for half an hour.
 *  - **It does not drain the burst queue.** The ask is still holding its slot, so the asker's follow-up
 *    queues behind it instead of starting a second worker on the same thread.
 *  - **It posts nothing.** No `:warning:` reaction, no card correction — the worker's own first progress
 *    update is what confirms life, and a public false alarm over a session that is working is worse than
 *    silence.
 *
 * @param askIdentity the ask whose pickup went unwitnessed
 * @param home the resolved state home
 * @param session the booted workspace the line was sent into, named in the recorded reason
 */
export function recordDispatchUnwitnessed({
  askIdentity,
  home,
  session,
}: {
  askIdentity: AskIdentity;
  home: string;
  session: FreshVisibleSessionRef;
}): void {
  appendAskLifecycleEvent({
    event: {
      ...askIdentity,
      kind: "dispatch-unwitnessed",
      reason:
        `the pickup command was sent into workspace ${session.workspaceRef} and nothing witnessed it ` +
        `arriving — it was NOT re-sent, and the worker is treated as running until a sweep proves otherwise`,
      tsIso: new Date().toISOString(),
    },
    home,
  });
}

/**
 * Verify a just-recorded dispatch actually holds a live session, through the workspace id the record itself
 * carries — the dispatch side of the same check `./liveScreenRead.ts` runs on every poll and sweep.
 *
 * A `phantom` verdict here is the strongest form of the defect this whole seam exists to remove: the boot
 * witness answered, the pickup command was confirmed, and the workspace is nonetheless empty. `unknown` is
 * NOT a failure — a cmux socket that will not answer is a broken oracle, and refusing a dispatch over one
 * would trade a rare false green for a common false red.
 *
 * @param checkLiveness the liveness check to run
 * @param session the just-recorded session locator
 * @returns the phantom reason, or `undefined` when the workspace is alive or could not be judged
 */
export async function phantomReasonFor({
  checkLiveness,
  session,
}: {
  checkLiveness: WorkspaceLivenessCheck;
  session: FreshVisibleSessionRef;
}): Promise<string | undefined> {
  const liveness = await checkLiveness({ workspaceId: session.workspaceId });
  return liveness.kind === "phantom" ? liveness.reason : undefined;
}
