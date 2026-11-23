/**
 * What counts as done for close-done — the evidence vocabulary, and the bot loop's dispatch children judged by
 * the TURN they belong to. Split from `./closeDone.ts`, whose planner reads both; neither touches disk.
 */

import type { DispatchSessionRole } from "../cmux/planNames.js";
import type { TerminalDocStatus } from "../handover/doc.js";
import type { AskSettlement } from "../handover/rowKind.js";
import type { TerminalAskLifecycleEvent } from "../live/ask/lifecycle.js";
import { type ReviewPosture, withinReviewHold } from "../live/turn/leaseJudgement.js";
import { effectiveLeaseExpiresAt, isLeaseExpired } from "../live/turn/tier.js";
import type { DispatchChild } from "./dispatchChildren.js";

/** Why one open ledger row counts as done — each is a fact on disk a reader can re-check. */
export type DoneEvidence =
  /** The slug's run journal's current cycle ended in `finished` or `abandoned`. */
  | { readonly kind: "run-closed" }
  /** The ask this row was spawned for carries a `settlement:`. */
  | { readonly kind: "ask-settled"; readonly settlement: AskSettlement }
  /** The doc this row was spawned for reached a terminal status. */
  | { readonly kind: "doc-terminal"; readonly status: TerminalDocStatus }
  /** The bot turn this dispatch child belongs to reached a terminal ask-lifecycle event. */
  | {
      readonly kind: "turn-finalised";
      readonly role: DispatchSessionRole;
      readonly terminal: TerminalAskLifecycleEvent["kind"];
    }
  /** A review child whose parent worker's dispatch lease has run out — nothing will consume its verdict. */
  | { readonly kind: "parent-lease-expired" }
  /** A review child whose parent worker's own workspace is no longer in the live cmux inventory. */
  | { readonly kind: "parent-worker-gone" };

/** Whether the worker holding a review child's parent ask is still live in cmux. */
export type WorkerWorkspaceState =
  /** A tracked worker row for this ask pairs to a live workspace. */
  | "live"
  /** At least one worker row is known for this ask, and none of them pairs to a live workspace. */
  | "gone"
  /** No worker row is known at all, so nothing here can say — which keeps the reviewer. */
  | "unknown";

/**
 * Whether the bot turn a dispatch child belongs to is over, and which fact says so.
 *
 * Three endings, and the asymmetry between the two roles is the rule rather than an omission. A terminal
 * ask-lifecycle event ends BOTH: the answer posted, or the ask was withheld or triaged, so neither a worker
 * nor a reviewer has anything left to produce. The other two end only a REVIEW child. A worker whose lease
 * ran out or whose ask stalled is a session someone may still want to read — that is the diagnosis, and
 * `../live/ask/lifecycle.ts` keeps `lease-expired` deliberately non-terminal for exactly that reason —
 * while a reviewer past either point is producing a verdict no door is open to consume
 * (`../live/turn/reviewRelease.ts`).
 *
 * **The parent's lease clock is not a safe proxy for that, and this function must not treat it as one.**
 * MEASURED on one ask: the worker's lease lapsed, a review
 * round 2 opened thirty-two minutes later with no verdict written, and a `close-done` run from an
 * unrelated seat reaped it soon after as `parent lease expired` — leaving the turn ready-and-unposted
 * with no verdict path at all until the loop noticed and the worker re-opened round 3 on `workspace:231`.
 * The recorded `lease-expired` fold state was THIRTY-TWO MINUTES OLDER than the reviewer it was used to
 * judge, so it was not an imprecise proxy; it was answering about a different object. The sweep half of this
 * seam already knew better — `../live/turn/leaseJudgement.ts`'s `leaseState` answers `held` while a reviewer
 * is mid-verdict, "and its time is not the worker's to pay for" — so the two verbs read one state and
 * disagreed, and only this one could close a workspace. **An open review now holds the reaper exactly as it
 * holds the clock**, bounded by the same `withinReviewHold` cap so a wedged reviewer cannot pin its
 * workspace open forever.
 *
 * Two neighbours are deliberately NOT gated on the review, and each for its own reason:
 *
 * - **A terminal ask still reaps**, ahead of the guard. `../live/turn/reviewRelease.ts`'s `reviewerReaping`
 *   is a standing ruling that a terminal outcome releases its reviewer ungated on liveness — "the ask is
 *   over either way, so a reviewer that is still working is the strongest case for closing it". Reversing
 *   that here would be the same mistake in mirror image.
 * - **`parent-worker-gone` still reaps.** It is not a clock proxy but a direct statement about the
 *   CONSUMER: `./closeDone.ts`'s `workerWorkspaceLookup` asks the live inventory by the worker's own
 *   `dispatchWorkspaceName`, which survives a cmux renumber, and answers `unknown` — which keeps the
 *   reviewer — whenever no worker row is known at all. A verdict with no worker left to read it really is
 *   unconsumable.
 *
 * `hasUsableVerdict` is likewise not a keep. A reviewer that has WRITTEN its verdict is finished, and
 * `../live/turn/reviewPosture.ts` makes the two mutually exclusive by construction: `inFlight` requires that
 * no verdict file be present. An idle workspace holding a finished verdict is pure cost.
 *
 * **The residue, stated rather than left to be rediscovered as a bug.** One dispatch session key and one
 * `dispatchWorkspaceName` cover every ROUND of an ask's review (`./closeDone.ts`'s header), so while round 3
 * is in flight a superseded round-2 workspace is indistinguishable by name and is now KEPT rather than reaped
 * until the current round writes a verdict or the ask goes terminal. That is the safe direction — one more
 * sweep tick against a lost turn — and it is the one close-done already takes for `dispatch-ref-reused`
 * and for an unreadable screen. `ReviewRecord.reviewer.workspaceRef` looks like the discriminator that
 * would close it, but it is stamped at spawn and goes stale across the renumber the pairing exists not to
 * trust.
 *
 * @param child the resolved child and the ask it belongs to
 * @param nowIso the instant to judge the parent's lease and the review hold against
 * @param review what the parent ask's review looks like on disk right now
 * @param workerWorkspace whether the parent worker is still live in cmux; `unknown` keeps the reviewer
 * @returns the evidence, or `undefined` when the turn is still running
 */
export function dispatchDoneEvidence({
  child,
  nowIso,
  review,
  workerWorkspace,
}: {
  child: DispatchChild;
  nowIso: string;
  review: ReviewPosture;
  workerWorkspace: WorkerWorkspaceState;
}): DoneEvidence | undefined {
  if (child.terminal !== undefined) {
    return { kind: "turn-finalised", role: child.role, terminal: child.terminal.kind };
  }
  if (child.role === "ask") {
    return undefined;
  }
  // The guard wraps the LEASE arms and nothing else: `parent-worker-gone` below is a fact about the
  // verdict's consumer rather than a clock proxy, so a reviewer mid-verdict is no reason to keep it.
  const midVerdict = review.inFlight && withinReviewHold({ nowIso, spawnedAt: review.spawnedAt });
  const active = child.lifecycle.activeDispatch;
  if (!midVerdict) {
    // Both readings are needed: a recorded `lease-expired` event CLEARS `activeDispatch`, so the field alone
    // misses an expiry the loop has already acted on, and an unswept dispatch carries an expiry nothing has
    // recorded yet.
    if (child.lifecycle.state === "lease-expired") {
      return { kind: "parent-lease-expired" };
    }
    // The EFFECTIVE lease: a first answer re-arms the clock (`../live/turn/tier.ts`), and the final answer's
    // own reviewer must not be reaped against the lease the plan was posted under.
    const leaseExpiresAt =
      active === undefined
        ? undefined
        : effectiveLeaseExpiresAt({ activeDispatch: active, firstAnswer: child.lifecycle.firstAnswer });
    if (leaseExpiresAt !== undefined && isLeaseExpired({ leaseExpiresAt, nowIso })) {
      return { kind: "parent-lease-expired" };
    }
  }
  return workerWorkspace === "gone" ? { kind: "parent-worker-gone" } : undefined;
}
