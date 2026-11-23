/**
 * What cmux says about a dispatch's WORKER, read by `turn dispatch --sweep` only when a finding turns on it —
 * its delivery record, which settles an unwitnessed pickup, and its liveness, which is the one reprieve a
 * `ready` answer gets once its lease has run out. Split out of `./dispatchSweep.ts` along that seam: both are
 * reads of the worker's own workspace, each consulted in exactly one narrow case, and neither decides a
 * finding on its own — `../../../live/turn/dispatch.ts`'s `sweepDecision` does.
 */
import type { WorkspaceLivenessCheck } from "../../../cmux/liveness.js";
import { askIdentityOf } from "../../../live/ask/identity.js";
import type { AskLifecycle, DispatchedEvent } from "../../../live/ask/lifecycle.js";
import { appendAskLifecycleEvent } from "../../../live/ask/store.js";
import { type FreshDispatchRecord, unwitnessedPickupCorroboration } from "../../../live/turn/dispatch.js";
import { effectiveLeaseExpiresAt, isLeaseExpired } from "../../../live/turn/tier.js";
import type { LiveScreenRead } from "./liveScreenRead.js";

/**
 * Whether a `ready` dispatch past its lease still has a live worker behind it — the one reprieve
 * `sweepDecision` weighs for a validated-but-unposted answer once the clock has run out. Asks cmux only in
 * that case, so a ready ask inside its lease, and every other finding, costs no liveness read at all; a
 * durable `ready` marker is read without cmux on purpose (`./liveScreenRead.ts`).
 *
 * A dispatch whose worker already posted its FIRST answer is the second case it is asked for: that worker is
 * building what the plan promised, so past the effective lease a `working` or `unreachable` screen is checked
 * too, and a positive `alive` is the reprieve `sweepDecision` caps exactly as it caps a ready one.
 *
 * @param deps the sweep's seams; only its liveness check is read, real or a test's plain fake
 * @param dispatched the ask's active dispatch, carrying the lease
 * @param firstAnswer the first answer the dispatch already posted, carrying the re-armed lease, when one stands
 * @param nowIso the sweep's instant
 * @param read this generation's live screen read, or `undefined` for a dispatch with no workspace
 * @returns true only when cmux positively reports a running host; `unknown` and `phantom` are both false
 */
export async function readyWorkerAlivePastLease({
  deps,
  dispatched,
  firstAnswer,
  nowIso,
  read,
}: {
  deps: { readonly workerLiveness: WorkspaceLivenessCheck };
  dispatched: DispatchedEvent;
  firstAnswer?: { readonly leaseExpiresAt: string } | undefined;
  nowIso: string;
  read: (LiveScreenRead & { readonly record: FreshDispatchRecord }) | undefined;
}): Promise<boolean> {
  if (read === undefined) {
    return false;
  }
  const building = firstAnswer !== undefined && (read.truth.kind === "working" || read.truth.kind === "unreachable");
  const leaseExpiresAt = effectiveLeaseExpiresAt({ activeDispatch: dispatched, firstAnswer });
  if ((read.truth.kind !== "ready" && !building) || !isLeaseExpired({ leaseExpiresAt, nowIso })) {
    return false;
  }
  const liveness = await deps.workerLiveness({ workspaceId: read.record.session.workspaceId });
  return liveness.kind === "alive";
}

/**
 * Settle an ask sitting at `dispatch-unwitnessed` when cmux's own delivery record now corroborates its
 * pickup — the reconciliation that keeps the state from being permanent.
 *
 * A no-op for every other state, and a no-op when nothing corroborates: an unwitnessed dispatch that stays
 * unwitnessed goes on being swept exactly like a running one, so the ordinary endings (`ready`,
 * `worker-failed`, `lease-expired`, `phantom`) are what eventually close it. That is deliberate — the only
 * thing this function can honestly add is a POSITIVE confirmation, and inventing a negative from the absence
 * of one is the reasoning that produced `dispatch-failed` in the first place.
 *
 * @param deps the sweep's seams: cmux's delivery record for one workspace, and the sweep's own output channel
 * @param entry the ask being swept
 * @param home the resolved state home
 * @param nowIso the current instant
 * @param record this generation's dispatch record, naming the workspace to ask about
 */
export async function reconcileUnwitnessedDispatch({
  deps,
  entry,
  home,
  nowIso,
  record,
}: {
  deps: {
    readonly latestSubmittedMessage: (input: { workspaceId: string }) => Promise<string | undefined>;
    readonly writeLine: (input: { line: string }) => void;
  };
  entry: AskLifecycle;
  home: string;
  nowIso: string;
  record: FreshDispatchRecord | undefined;
}): Promise<void> {
  if (entry.state !== "dispatch-unwitnessed" || record === undefined) {
    return;
  }
  const reason = unwitnessedPickupCorroboration({
    askIdentity: entry,
    latestSubmittedMessage: await deps.latestSubmittedMessage({ workspaceId: record.session.workspaceId }),
  });
  if (reason === undefined) {
    return;
  }
  appendAskLifecycleEvent({
    event: { ...askIdentityOf({ source: entry }), kind: "dispatch-witnessed", reason, tsIso: nowIso },
    home,
  });
  deps.writeLine({ line: `dispatch-witnessed (reconciled): ${entry.channel}/${entry.messageTs} — ${reason}` });
}
